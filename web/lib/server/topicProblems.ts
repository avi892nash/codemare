import 'server-only';
import type { Difficulty } from '@/lib/types';
import { questionAccessMap } from './access';
import { prisma } from './db';
import { difficultyRank } from './rules/recipes';

/**
 * The problems behind each topic, for the tier map (/map lists them on its
 * topic cards — it is how learners find problems, decision 39): every
 * published question under each of its topics, a composite question under
 * all of them, in curriculum order, with this learner's progress and
 * whether it opens for them (questionAccessMap, spec §3.4: every topic
 * unlocked, or part of a running gate attempt).
 */

/** This learner's progress on a question. */
export type ProblemProgress = 'solved' | 'attempted' | 'todo';

export interface TopicProblem {
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** All of the question's topics, heaviest weight first. */
  topicIds: string[];
  progress: ProblemProgress;
  /** It opens for this learner now. */
  open: boolean;
}

export interface TopicProblems {
  /** topic id → its published questions, in curriculum order. */
  byTopic: Map<string, TopicProblem[]>;
  /** Published questions without any topic (a content gap no topic card would show), in curriculum order. */
  unfiled: TopicProblem[];
}

/**
 * This user's progress per question: `solved` once any submit or gate
 * submission is accepted; `attempted` after any run / submit / gate without
 * that. Questions it leaves out are `todo`.
 */
export async function userQuestionProgress(userId: string): Promise<Map<string, Exclude<ProblemProgress, 'todo'>>> {
  const groups = await prisma.submission.groupBy({
    by: ['questionId', 'kind', 'status'],
    where: { userId, questionId: { not: null } },
    _count: { _all: true },
  });
  const progress = new Map<string, Exclude<ProblemProgress, 'todo'>>();
  for (const g of groups) {
    if (!g.questionId) continue;
    if (g.status === 'OK' && (g.kind === 'submit' || g.kind === 'gate')) progress.set(g.questionId, 'solved');
    else if (!progress.has(g.questionId)) progress.set(g.questionId, 'attempted');
  }
  return progress;
}

/** What curriculum order looks at: the primary (heaviest) topic's place, then the question itself. */
export interface CurriculumKey {
  /** The heaviest topic's tier order and its order within the tier; null without topics. */
  primary: { tierOrd: number; ord: number } | null;
  difficulty: Difficulty;
  title: string;
  slug: string;
}

/**
 * Curriculum order: the primary topic's tier, then that topic's place in
 * its tier, then difficulty, then title. Topic-less questions last. A
 * topic's own list keeps this order, so a composite question sits where its
 * primary topic falls in the curriculum.
 */
export function compareCurriculum(a: CurriculumKey, b: CurriculumKey): number {
  if (a.primary && !b.primary) return -1;
  if (!a.primary && b.primary) return 1;
  if (a.primary && b.primary) {
    if (a.primary.tierOrd !== b.primary.tierOrd) return a.primary.tierOrd - b.primary.tierOrd;
    if (a.primary.ord !== b.primary.ord) return a.primary.ord - b.primary.ord;
  }
  return (
    difficultyRank(a.difficulty) - difficultyRank(b.difficulty) ||
    a.title.localeCompare(b.title, 'en') ||
    a.slug.localeCompare(b.slug, 'en')
  );
}

/** Every published question, grouped under each of its topics, for `userId`. */
export async function listTopicProblems(userId: string, now: Date = new Date()): Promise<TopicProblems> {
  const [questions, progress] = await Promise.all([
    prisma.question.findMany({
      where: { status: 'published' },
      select: {
        id: true,
        slug: true,
        title: true,
        difficulty: true,
        topics: { select: { topicId: true, weight: true, topic: { select: { ord: true, tier: { select: { ord: true } } } } } },
      },
    }),
    userQuestionProgress(userId),
  ]);
  const access = await questionAccessMap(userId, questions.map((q) => q.id), now);

  const keyed = questions
    .map((q) => {
      const topics = q.topics
        .map((t) => ({ id: t.topicId, weight: t.weight, tierOrd: t.topic.tier.ord, ord: t.topic.ord }))
        .sort((a, b) => b.weight - a.weight || a.tierOrd - b.tierOrd || a.ord - b.ord);
      const problem: TopicProblem = {
        id: q.id,
        slug: q.slug,
        title: q.title,
        difficulty: q.difficulty,
        topicIds: topics.map((t) => t.id),
        progress: progress.get(q.id) ?? 'todo',
        open: access.get(q.id) ?? false,
      };
      const key: CurriculumKey = {
        primary: topics[0] ? { tierOrd: topics[0].tierOrd, ord: topics[0].ord } : null,
        difficulty: q.difficulty,
        title: q.title,
        slug: q.slug,
      };
      return { problem, key };
    })
    .sort((a, b) => compareCurriculum(a.key, b.key));

  const byTopic = new Map<string, TopicProblem[]>();
  const unfiled: TopicProblem[] = [];
  for (const { problem } of keyed) {
    if (problem.topicIds.length === 0) unfiled.push(problem);
    for (const id of problem.topicIds) {
      const list = byTopic.get(id);
      if (list) list.push(problem);
      else byTopic.set(id, [problem]);
    }
  }
  return { byTopic, unfiled };
}
