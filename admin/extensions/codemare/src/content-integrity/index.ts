/**
 * Server-side guards for every write Directus makes to content.* — the data
 * studio, the REST/GraphQL API and the recipe editor alike (nested O2M
 * writes run the same filters per row).
 *
 *   · ids: content ids have no database default (Prisma generates cuids in
 *     the client), so creates without an id get a Prisma-format cuid.
 *   · Postgres arrays: Directus types text[] / enum[] columns as `unknown`
 *     and JSON-encodes arrays on write; they are converted to array literals.
 *     Enum arrays come back from node-postgres as '{a,b}' text and are parsed.
 *   · questions.updated_at: Prisma's @updatedAt is client-side only.
 *   · recipes: quantity must be a whole number ≥ 1 (a CHECK constraint too,
 *     reported here as a readable 400) and an item may not spend the tokens
 *     of the topic its recipe unlocks.
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
import { parsePgArrayLiteral, toPgArrayLiteral } from '../shared/pg-array';

type Row = Record<string, unknown>;
// The knex transaction Directus hands to filters; typed loosely on purpose.
type Db = (table: string) => any;

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
    throw new InvalidPayloadError({ reason: 'Recipe item quantity must be a whole number of at least 1' });
  }
}

async function topicOfRecipe(db: Db, recipeId: unknown): Promise<string | undefined> {
  if (typeof recipeId !== 'string') return undefined;
  const row = await db('unlock_recipes').select('topic_id').where({ id: recipeId }).first();
  return row?.topic_id;
}

function ownTokensError(): Error {
  return new InvalidPayloadError({
    reason: "A recipe item cannot spend the tokens of the topic its recipe unlocks (they are only earned after the unlock)",
  });
}

export default defineHook(({ filter }) => {
  filter('items.create', async (input, meta, context) => {
    const collection = meta.collection as string;
    if (!isContentCollection(collection)) return input;
    const payload = input as Row;
    if (payload.id === undefined || payload.id === null || payload.id === '') payload.id = cuid();
    encodeArrays(collection, payload);

    if (collection === 'recipe_items') {
      assertQuantity(payload);
      const topicId = await topicOfRecipe(context.database as Db, payload.recipe_id);
      if (topicId && payload.token_topic_id === topicId) throw ownTokensError();
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
    return payload;
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
