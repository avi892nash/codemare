/**
 * Server-side guards for every write Directus makes to content.* — the data
 * studio, the REST/GraphQL API and the recipe editor alike (nested O2M
 * writes run the same filters per row, in the same transaction).
 *
 *   · ids: content ids have no database default (Prisma generates cuids in
 *     the client), so creates without an id get a Prisma-format cuid. That
 *     includes the join tables' surrogate ids.
 *   · Postgres arrays: Directus types text[] / enum[] columns as `unknown`
 *     and JSON-encodes arrays on write; they are converted to array literals.
 *     Enum arrays come back from node-postgres as '{a,b}' text and are parsed.
 *   · questions.updated_at: Prisma's @updatedAt is client-side only.
 *   · recipes: quantity must be a whole number ≥ 1 (a CHECK constraint too,
 *     reported here as a readable 400) and an item may not spend the tokens
 *     of the topic its recipe unlocks.
 *   · question topics: weight > 0 (a CHECK constraint too).
 *   · component dependencies: no self-dependency (a CHECK constraint too) and
 *     no cycles — the web app's own graph rules, as the seed validator uses.
 *   · gates: never fewer questions than `pass_threshold` (the seed
 *     validator's rule), whether questions are removed or the threshold raised.
 *
 * Postgres CHECK violations would otherwise surface as a bare 500: Directus
 * only translates unique, not-null, foreign-key and range errors.
 */
import { defineHook } from '@directus/extensions-sdk';
import { InvalidPayloadError } from '@directus/errors';
import {
  ARRAY_COLUMNS,
  ENUM_ARRAY_COLUMNS,
  UPDATED_AT_COLUMNS,
  isContentCollection,
} from '../shared/content-tables';
import { cuid } from '../shared/cuid';
import {
  WEIGHT_MESSAGE,
  dependencyProblem,
  gateQuestionCountAfter,
  gateThresholdProblem,
  isValidWeight,
  type DepEdge,
} from '../shared/join-checks';
import { parsePgArrayLiteral, toPgArrayLiteral } from '../shared/pg-array';

type Row = Record<string, unknown>;
// The knex transaction Directus hands to filters; typed loosely on purpose.
type Db = (table: string) => any;

const invalid = (reason: string) => new InvalidPayloadError({ reason });

function encodeArrays(collection: string, payload: Row): void {
  for (const column of ARRAY_COLUMNS[collection] ?? []) {
    const value = payload[column];
    if (Array.isArray(value)) payload[column] = toPgArrayLiteral(value);
  }
}

function assertQuantity(payload: Row): void {
  if (!('quantity' in payload)) return;
  const q = payload.quantity;
  if (typeof q !== 'number' || !Number.isInteger(q) || q < 1) {
    throw invalid('Recipe item quantity must be a whole number of at least 1');
  }
}

async function topicOfRecipe(db: Db, recipeId: unknown): Promise<string | undefined> {
  if (typeof recipeId !== 'string') return undefined;
  const row = await db('unlock_recipes').select('topic_id').where({ id: recipeId }).first();
  return row?.topic_id;
}

function ownTokensError(): Error {
  return invalid(
    'A recipe item cannot spend the tokens of the topic its recipe unlocks (they are only earned after the unlock)'
  );
}

function assertWeight(payload: Row): void {
  if ('weight' in payload && !isValidWeight(payload.weight)) throw invalid(WEIGHT_MESSAGE);
}

/** Rejects `edge` if it is a self-dependency or closes a cycle; `exceptId` is the row being rewritten. */
async function assertDependency(db: Db, edge: Partial<DepEdge>, exceptId?: string): Promise<void> {
  const { componentId, dependsOnId } = edge;
  // A dependency on a component created in the same request cannot close a cycle.
  if (typeof componentId !== 'string' || typeof dependsOnId !== 'string') return;
  const rows: { id: string; component_id: string; depends_on_id: string }[] = await db('component_deps').select(
    'id',
    'component_id',
    'depends_on_id'
  );
  const others = rows
    .filter((r) => r.id !== exceptId)
    .map((r) => ({ componentId: r.component_id, dependsOnId: r.depends_on_id }));
  const components: { id: string; title: string }[] = await db('components').select('id', 'title');
  const titles = new Map(components.map((c) => [c.id, c.title]));
  const problem = dependencyProblem({ componentId, dependsOnId }, others, (id) => titles.get(id) ?? id);
  if (problem) throw invalid(problem);
}

async function gateQuestionIds(db: Db, gateId: string): Promise<string[]> {
  const rows: { id: string }[] = await db('gate_questions').select('id').where({ gate_id: gateId });
  return rows.map((r) => r.id);
}

/** After a gate write: its threshold against its question count (nested `questions` changes included). */
function assertGate(gate: { title: string; passThreshold: unknown }, current: readonly string[], change: unknown): void {
  const threshold = Number(gate.passThreshold);
  if (!Number.isFinite(threshold)) return; // not-null / type errors are Directus' to report
  const problem = gateThresholdProblem(gate.title, threshold, gateQuestionCountAfter(current, change));
  if (problem) throw invalid(problem);
}

/** Gate questions leaving their gates (deleted, or moved to another gate). */
async function assertGatesKeepQuestions(db: Db, leaving: string[], movingTo?: unknown): Promise<void> {
  if (leaving.length === 0) return;
  const rows: { gate_id: string }[] = await db('gate_questions').select('gate_id').whereIn('id', leaving);
  for (const gateId of new Set(rows.map((r) => r.gate_id))) {
    if (gateId === movingTo) continue;
    const gate = await db('gates').select('title', 'pass_threshold').where({ id: gateId }).first();
    if (!gate) continue;
    const left = (await gateQuestionIds(db, gateId)).filter((id) => !leaving.includes(id)).length;
    const problem = gateThresholdProblem(gate.title, Number(gate.pass_threshold), left);
    if (problem) throw invalid(problem);
  }
}

export default defineHook(({ filter }) => {
  filter('items.create', async (input, meta, context) => {
    const collection = meta.collection as string;
    if (!isContentCollection(collection)) return input;
    const payload = input as Row;
    if (payload.id === undefined || payload.id === null || payload.id === '') payload.id = cuid();
    encodeArrays(collection, payload);
    const db = context.database as Db;

    if (collection === 'recipe_items') {
      assertQuantity(payload);
      const topicId = await topicOfRecipe(db, payload.recipe_id);
      if (topicId && payload.token_topic_id === topicId) throw ownTokensError();
    }
    if (collection === 'question_topics') assertWeight(payload);
    if (collection === 'component_deps') {
      await assertDependency(db, {
        componentId: payload.component_id as string,
        dependsOnId: payload.depends_on_id as string,
      });
    }
    if (collection === 'gates') {
      assertGate({ title: String(payload.title ?? 'new gate'), passThreshold: payload.pass_threshold }, [], payload.questions);
    }
    return payload;
  });

  filter('items.update', async (input, meta, context) => {
    const collection = meta.collection as string;
    if (!isContentCollection(collection)) return input;
    const payload = input as Row;
    encodeArrays(collection, payload);
    const updatedAt = UPDATED_AT_COLUMNS[collection];
    if (updatedAt && !(updatedAt in payload)) payload[updatedAt] = new Date().toISOString();

    const db = context.database as Db;
    const keys = ((meta as { keys?: unknown[] }).keys ?? []) as string[];

    if (collection === 'recipe_items') {
      assertQuantity(payload);
      if ('token_topic_id' in payload || 'recipe_id' in payload) {
        for (const key of keys) {
          const current = await db('recipe_items').select('recipe_id', 'token_topic_id').where({ id: key }).first();
          const recipeId = 'recipe_id' in payload ? payload.recipe_id : current?.recipe_id;
          const tokenTopicId = 'token_topic_id' in payload ? payload.token_topic_id : current?.token_topic_id;
          if (tokenTopicId && tokenTopicId === (await topicOfRecipe(db, recipeId))) throw ownTokensError();
        }
      }
    }

    if (collection === 'unlock_recipes' && typeof payload.topic_id === 'string') {
      const clash = await db('recipe_items')
        .whereIn('recipe_id', keys)
        .andWhere('token_topic_id', payload.topic_id)
        .first();
      if (clash) throw ownTokensError();
    }

    if (collection === 'question_topics') assertWeight(payload);

    if (collection === 'component_deps' && ('component_id' in payload || 'depends_on_id' in payload)) {
      for (const key of keys) {
        const current = await db('component_deps').select('component_id', 'depends_on_id').where({ id: key }).first();
        await assertDependency(
          db,
          {
            componentId: ('component_id' in payload ? payload.component_id : current?.component_id) as string,
            dependsOnId: ('depends_on_id' in payload ? payload.depends_on_id : current?.depends_on_id) as string,
          },
          key
        );
      }
    }

    if (collection === 'gates' && ('pass_threshold' in payload || 'questions' in payload)) {
      for (const key of keys) {
        const gate = await db('gates').select('title', 'pass_threshold').where({ id: key }).first();
        if (!gate) continue;
        const passThreshold = 'pass_threshold' in payload ? payload.pass_threshold : gate.pass_threshold;
        assertGate({ title: gate.title, passThreshold }, await gateQuestionIds(db, key), payload.questions);
      }
    }

    if (collection === 'gate_questions' && 'gate_id' in payload) {
      await assertGatesKeepQuestions(db, keys, payload.gate_id);
    }
    return payload;
  });

  filter('items.delete', async (keys, meta, context) => {
    if (meta.collection === 'gate_questions') {
      await assertGatesKeepQuestions(context.database as Db, (keys as unknown[]).map(String));
    }
    return keys;
  });

  filter('items.read', (records, meta) => {
    const columns = ENUM_ARRAY_COLUMNS[meta.collection as string];
    if (!columns || !Array.isArray(records)) return records;
    for (const record of records as Row[]) {
      for (const column of columns) {
        const value = record?.[column];
        if (typeof value === 'string') record[column] = parsePgArrayLiteral(value) ?? value;
      }
    }
    return records;
  });
});
