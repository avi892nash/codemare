/**
 * GET /codemare/recipe-supply — the tokens all published content pays out,
 * per topic and source difficulty: first accepted solves of published
 * questions (split across question_topics by weight), with no hint
 * penalties. Solving questions is the only way to earn tokens. Same
 * computation as the seed validator's affordability check, using the web
 * app's award rules.
 *
 * It is an endpoint rather than plain item reads so the whole aggregate is
 * one query, computed server-side with the award rules (the editor would
 * otherwise page through every question topic).
 * Access: signed-in users who may read unlock_recipes (the recipe editor's
 * audience); everything else gets 403.
 */
import { defineEndpoint } from '@directus/extensions-sdk';
import { ForbiddenError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import { balancesFromRows, solveAward, type Difficulty } from '../shared/rules';

interface QuestionTopicRow {
  question_id: string;
  topic_id: string;
  weight: number | string;
  difficulty: Difficulty;
}

type Counts = Record<string, { questions: number }>;

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

        const byQuestion = new Map<string, QuestionTopicRow[]>();
        for (const row of questionRows) {
          const list = byQuestion.get(row.question_id) ?? [];
          list.push(row);
          byQuestion.set(row.question_id, list);
        }

        const rows: { topicId: string; difficulty: Difficulty; amount: number }[] = [];
        const counts: Counts = {};
        for (const topics of byQuestion.values()) {
          const difficulty = topics[0].difficulty;
          const awards = solveAward(
            difficulty,
            topics.map((t) => ({ topicId: t.topic_id, weight: Number(t.weight) })),
            0
          );
          for (const a of awards) rows.push({ topicId: a.topicId, difficulty, amount: a.amount });
          for (const t of topics) {
            counts[t.topic_id] ??= { questions: 0 };
            counts[t.topic_id].questions++;
          }
        }

        res.json({ data: { supply: balancesFromRows(rows), counts } });
      } catch (error) {
        next(error);
      }
    });
  },
});
