import 'server-only';
import type { Difficulty } from '@/lib/types';
import { prisma } from './db';
import { listTopicProblems, type TopicProblem } from './topicProblems';

/**
 * "Next problem" (the accepted result's primary action): the next problem
 * this learner has not solved yet that opens for them — first in the current
 * problem's own topic, after it, then in the topics that follow in curriculum
 * order. Built on the map's problem lists (topicProblems.ts: curriculum order,
 * progress, and `open` from questionAccessMap — spec §3.4), so it never points
 * at a locked problem. Nothing left → null, and the result offers the map only.
 */

/** What the page hands the workspace (JSON-safe). */
export interface NextProblem {
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** The topic it was found under. */
  topicTitle: string;
}

/** What `chooseNextProblem` looks at. */
export interface NextProblemInput {
  /** The question being solved. */
  currentId: string;
  /** Its topics, heaviest first — the first is its place in the curriculum. */
  currentTopicIds: readonly string[];
  /** Every topic id in curriculum order (tier, then place in the tier). */
  topicOrder: readonly string[];
  /** topic id → its published questions, in curriculum order. */
  byTopic: ReadonlyMap<string, readonly TopicProblem[]>;
}

/** Open and not solved yet (a run or a failed submit is only an attempt). */
const canStart = (p: TopicProblem, currentId: string) => p.id !== currentId && p.open && p.progress !== 'solved';

/**
 * The choice itself, pure: the first unsolved, open problem after the current
 * one in its primary topic; else the first in each following topic, in order.
 * A composite question is skipped where it shows up again. Null when the
 * current question has no topic, or nothing is left ahead of it.
 */
export function chooseNextProblem({ currentId, currentTopicIds, topicOrder, byTopic }: NextProblemInput): { problem: TopicProblem; topicId: string } | null {
  const primary = currentTopicIds[0];
  const at = primary === undefined ? -1 : topicOrder.indexOf(primary);
  if (at < 0) return null;

  const own = byTopic.get(primary) ?? [];
  const after = own.slice(own.findIndex((p) => p.id === currentId) + 1); // not in its list (a draft)? the whole list
  const here = after.find((p) => canStart(p, currentId));
  if (here) return { problem: here, topicId: primary };

  for (const topicId of topicOrder.slice(at + 1)) {
    const found = (byTopic.get(topicId) ?? []).find((p) => canStart(p, currentId));
    if (found) return { problem: found, topicId };
  }
  return null;
}

/** The next problem for `userId` after `currentQuestionId`, or null. */
export async function getNextProblem(userId: string, currentQuestionId: string, now: Date = new Date()): Promise<NextProblem | null> {
  const [{ byTopic }, topics, current] = await Promise.all([
    listTopicProblems(userId, now),
    prisma.topic.findMany({ orderBy: [{ tier: { ord: 'asc' } }, { ord: 'asc' }], select: { id: true, title: true } }),
    prisma.question.findUnique({ where: { id: currentQuestionId }, select: { topics: { orderBy: { weight: 'desc' }, select: { topicId: true } } } }),
  ]);
  const found = chooseNextProblem({
    currentId: currentQuestionId,
    currentTopicIds: (current?.topics ?? []).map((t) => t.topicId),
    topicOrder: topics.map((t) => t.id),
    byTopic,
  });
  if (!found) return null;
  const { problem, topicId } = found;
  return { slug: problem.slug, title: problem.title, difficulty: problem.difficulty, topicTitle: topics.find((t) => t.id === topicId)?.title ?? '' };
}
