/**
 * GET /codemare/recipe-supply — the tokens all published content pays out,
 * per topic and source difficulty: first accepted solves of published
 * questions (split across question_topics by weight) and first passing
 * builds of build steps, with no hint penalties. Same computation as the
 * seed validator's affordability check, using the web app's award rules.
 *
 * It is an endpoint rather than plain item reads because question_topics has
 * a composite primary key, which Directus does not expose as a collection.
 * Access: signed-in users who may read unlock_recipes (the recipe editor's
 * audience); everything else gets 403.
 */
import { defineEndpoint } from '@directus/extensions-sdk';
import { ForbiddenError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import { balancesFromRows, buildAward, solveAward, type Difficulty } from '../shared/rules';

interface QuestionTopicRow {
  question_id: string;
  topic_id: string;
  weight: number | string;
  difficulty: Difficulty;
}

interface BuildRow {
  topic_id: string;
  difficulty: Difficulty;
}

type Counts = Record<string, { questions: number; builds: number }>;

export default defineEndpoint({
  id: 'codemare',
  handler: (router, { database, services, getSchema }) => {
    router.get('/recipe-supply', async (req, res, next) => {
      try {
        const accountability = (req as unknown as { accountability?: Accountability }).accountability;
        if (!accountability?.user) throw new ForbiddenError();
        const schema = await getSchema();
        // Permission probe: throws ForbiddenError unless recipes are readable.
        await new services.ItemsService('unlock_recipes', { schema, accountability }).readByQuery({
          fields: ['id'],
          limit: 1,
        });

        const questionRows: QuestionTopicRow[] = await database
          .select('qt.question_id', 'qt.topic_id', 'qt.weight', 'q.difficulty')
          .from('question_topics as qt')
          .join('questions as q', 'q.id', 'qt.question_id')
          .where('q.status', 'published');
        const buildRows: BuildRow[] = await database
          .select('c.topic_id', 's.difficulty')
          .from('build_steps as s')
          .join('components as c', 'c.id', 's.component_id')
          .where('s.kind', 'build');

        const byQuestion = new Map<string, QuestionTopicRow[]>();
        for (const row of questionRows) {
          const list = byQuestion.get(row.question_id) ?? [];
          list.push(row);
          byQuestion.set(row.question_id, list);
        }

        const rows: { topicId: string; difficulty: Difficulty; amount: number }[] = [];
        const counts: Counts = {};
        const bump = (topicId: string, kind: 'questions' | 'builds') => {
          counts[topicId] ??= { questions: 0, builds: 0 };
          counts[topicId][kind]++;
        };
        for (const topics of byQuestion.values()) {
          const difficulty = topics[0].difficulty;
          const awards = solveAward(
            difficulty,
            topics.map((t) => ({ topicId: t.topic_id, weight: Number(t.weight) })),
            0
          );
          for (const a of awards) rows.push({ topicId: a.topicId, difficulty, amount: a.amount });
          for (const t of topics) bump(t.topic_id, 'questions');
        }
        for (const b of buildRows) {
          const amount = buildAward(b.difficulty, 0);
          if (amount > 0) rows.push({ topicId: b.topic_id, difficulty: b.difficulty, amount });
          bump(b.topic_id, 'builds');
        }

        res.json({ data: { supply: balancesFromRows(rows), counts } });
      } catch (error) {
        next(error);
      }
    });
  },
});
