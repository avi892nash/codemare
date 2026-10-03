import 'server-only';
import type { Difficulty } from '@/lib/types';
import { getMapState, type MapTopic, type RecipeView } from './access';
import { prisma } from './db';
import { NotFoundError } from './errors';
import { getGateAttempt, getGateStatus, type GateState, type GateStatus } from './gates';
import { getTopicBalances } from './ledger';
import { scorePenaltyFrom } from './rules/hints';
import { difficultyRank, meetsMinDifficulty, planDebits, type Balances } from './rules/recipes';
import { solveAward } from './rules/scoring';
import { listTopicProblems, type ProblemProgress, type TopicProblem } from './topicProblems';

/**
 * View models for the learning-loop pages — /map (T1, which is also how
 * learners find problems) and the gate attempt page — plus the navbar
 * token total. Every rule comes from the domain layer
 * (getMapState, planDebits, getGateAttempt, solveAward, …); this module only
 * joins and shapes, and returns JSON-safe data (dates as ISO strings) so
 * pages can hand it straight to client components.
 */

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface TopicLite {
  id: string;
  slug: string;
  title: string;
  icon: string;
}

// ─── Navbar ──────────────────────────────────────────────────────────────

/** The navbar chip: the sum of the user's topic balances. */
export async function getTokenTotal(userId: string): Promise<number> {
  const topics = await getTopicBalances(userId);
  return topics.reduce((sum, t) => sum + t.total, 0);
}

// ─── /map ────────────────────────────────────────────────────────────────

/**
 * unlocked · unlockable (tier open, a recipe is ready) · needs_tokens (tier
 * open, no recipe ready) · tier_closed (its gate is the blocker) ·
 * no_recipe (tier open but nothing to spend — a content gap).
 */
export type TopicCardState = 'unlocked' | 'unlockable' | 'needs_tokens' | 'tier_closed' | 'no_recipe';

export interface GateCardView {
  id: string;
  title: string;
  summary: string;
  passThreshold: number;
  cooldownHours: number;
  timeLimitMinutes: number;
  questionCount: number;
  questions: { slug: string; title: string; difficulty: Difficulty }[];
  /** How many of the gate's problems this learner has solved at all (an accepted submit anywhere, not only inside an attempt). */
  solvedCount: number;
  state: GateState;
  eligible: boolean;
  /** cooldown: when the gate can be retried (ISO). */
  nextEligibleAt: string | null;
  running: { attemptId: string; deadlineAt: string } | null;
  /** The latest finished attempt. */
  last: { attemptId: string; passed: boolean | null; passedCount: number; finishedAt: string | null } | null;
  attemptCount: number;
  /** The tier below, which must be open before this gate can be taken. */
  previousTier: { slug: string; title: string } | null;
}

export interface RecipeItemCard {
  topic: TopicLite;
  minDifficulty: Difficulty;
  need: number;
  have: number;
  missing: number;
}

/** One ledger debit a recipe spend would make: `amount` tokens from one (topic, difficulty) bucket. */
export interface SpendLine {
  topic: TopicLite;
  difficulty: Difficulty;
  amount: number;
}

export interface RecipeCard {
  id: string;
  title: string;
  ord: number;
  missing: number;
  totalQuantity: number;
  ready: boolean;
  items: RecipeItemCard[];
  /** Ready recipes: exactly what spending it would debit (cheapest buckets first). */
  spend: SpendLine[] | null;
}

/** A way to earn a missing token: a question to solve, and what its first accepted submit pays. */
export interface EarnOption {
  slug: string;
  title: string;
  difficulty: Difficulty;
  amount: number;
}

export type TopicBlockerView =
  | {
      kind: 'gate';
      tier: { slug: string; title: string };
      gate: { id: string; title: string; state: GateState; nextEligibleAt: string | null; attemptId: string | null } | null;
      /** The tier below — it must open first (gate state `previous_tier_closed`). */
      previousTier: { slug: string; title: string } | null;
    }
  | {
      kind: 'recipe';
      recipeId: string;
      recipeTitle: string;
      missing: number;
      ready: boolean;
      /** The cheapest recipe's items; missing ones carry ways to earn them. */
      items: (RecipeItemCard & { earn: EarnOption[] })[];
    }
  | { kind: 'no_recipe' };

/** A problem on the map: a link to the editor, unless a locked topic still keeps it closed. */
export interface TopicProblemView {
  slug: string;
  title: string;
  difficulty: Difficulty;
  progress: ProblemProgress;
  /** The locked topics keeping it closed (a composite question's other topics); empty when it opens. */
  needs: TopicLite[];
}

/** The problems a topic holds. */
export interface TopicProblemsView {
  /** Published questions in the topic, composites included. */
  total: number;
  /** …of which this learner has solved. */
  solved: number;
  /** The questions, in curriculum order — only once the topic is unlocked (locked topics show the count). */
  list: TopicProblemView[];
}

export interface TopicCardView extends TopicLite {
  summary: string;
  state: TopicCardState;
  /** Free tier-0 topics have no unlock row: null. */
  unlockedAt: string | null;
  viaRecipe: string | null;
  balance: { total: number; byDifficulty: Record<Difficulty, number> };
  /** Cheapest first; empty for free topics. */
  recipes: RecipeCard[];
  blocker: TopicBlockerView | null;
  problems: TopicProblemsView;
}

export interface TierView {
  id: string;
  ord: number;
  slug: string;
  title: string;
  summary: string;
  open: boolean;
  gate: GateCardView | null;
  topics: TopicCardView[];
}

export interface MapView {
  tiers: TierView[];
  /** Published questions without a topic, which no topic card lists (a content gap; normally empty). */
  unfiled: TopicProblemView[];
  totals: {
    tokens: number;
    topicsUnlocked: number;
    topicsTotal: number;
    tiersOpen: number;
    tiersTotal: number;
    /** Distinct published problems this learner has solved (the first-run card shows while it is 0). */
    solved: number;
  };
  /** The learner's running gate attempt, if any. */
  running: {
    attemptId: string;
    gateTitle: string;
    tierTitle: string;
    deadlineAt: string;
    solved: number;
    total: number;
    passThreshold: number;
  } | null;
}

const EARN_QUESTIONS = 3;

/** A published question every topic of which is unlocked, whose first solve hasn't paid out yet. */
export interface EarnableQuestion {
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** What the first accepted submit would pay now (hint penalty applied). */
  award: { topicId: string; amount: number }[];
}

/** Tokens `q` pays that count for a recipe item: its topic, at or above the item's minimum difficulty. */
export function questionServesWant(
  q: Pick<EarnableQuestion, 'difficulty' | 'award'>,
  item: { topicId: string; minDifficulty: Difficulty }
): number {
  if (!meetsMinDifficulty(q.difficulty, item.minDifficulty)) return 0;
  return q.award.find((a) => a.topicId === item.topicId)?.amount ?? 0;
}

/**
 * Questions the learner could earn tokens with right now: published, every
 * topic unlocked, first solve not paid yet — with the award their hint
 * penalty leaves.
 */
export async function loadEarnableQuestions(userId: string, unlockedTopicIds: ReadonlySet<string>): Promise<EarnableQuestion[]> {
  const [questions, paid, hintUses] = await Promise.all([
    prisma.question.findMany({
      where: { status: 'published' },
      select: { id: true, slug: true, title: true, difficulty: true, topics: { select: { topicId: true, weight: true } } },
    }),
    prisma.tokenLedger.findMany({
      where: { userId, reason: 'solve', refType: 'question', amount: { gt: 0 } },
      distinct: ['refId'],
      select: { refId: true },
    }),
    prisma.hintUse.findMany({ where: { userId, costKind: 'score' }, select: { questionId: true, costKind: true, costAmount: true } }),
  ]);
  const paidIds = new Set(paid.map((p) => p.refId));
  return questions
    .filter((q) => !paidIds.has(q.id) && q.topics.length > 0 && q.topics.every((t) => unlockedTopicIds.has(t.topicId)))
    .map((q) => ({
      id: q.id,
      slug: q.slug,
      title: q.title,
      difficulty: q.difficulty,
      award: solveAward(q.difficulty, q.topics, scorePenaltyFrom(hintUses.filter((u) => u.questionId === q.id))),
    }))
    .filter((q) => q.award.length > 0);
}

/** Questions that pay qualifying tokens of `item.topicId`, most tokens first. */
export function earnOptionsFor(item: { topicId: string; minDifficulty: Difficulty }, questions: readonly EarnableQuestion[]): EarnOption[] {
  return questions
    .map((q) => ({ q, amount: questionServesWant(q, item) }))
    .filter((x) => x.amount > 0)
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        difficultyRank(a.q.difficulty) - difficultyRank(b.q.difficulty) ||
        a.q.title.localeCompare(b.q.title)
    )
    .slice(0, EARN_QUESTIONS)
    .map(({ q, amount }) => ({ slug: q.slug, title: q.title, difficulty: q.difficulty, amount }));
}

function gateCard(
  status: GateStatus,
  questions: GateCardView['questions'],
  previousTier: GateCardView['previousTier'],
  solvedCount: number
): GateCardView {
  const { gate } = status;
  return {
    id: gate.id,
    title: gate.title,
    summary: gate.summary,
    passThreshold: gate.passThreshold,
    cooldownHours: gate.cooldownHours,
    timeLimitMinutes: gate.timeLimitMinutes,
    questionCount: gate.questionCount,
    questions,
    solvedCount,
    state: status.state,
    eligible: status.eligible,
    nextEligibleAt: iso(status.nextEligibleAt),
    running: status.runningAttempt
      ? { attemptId: status.runningAttempt.id, deadlineAt: status.runningAttempt.deadlineAt.toISOString() }
      : null,
    last: status.lastAttempt
      ? {
          attemptId: status.lastAttempt.id,
          passed: status.lastAttempt.passed,
          passedCount: status.lastAttempt.passedCount,
          finishedAt: iso(status.lastAttempt.finishedAt),
        }
      : null,
    attemptCount: status.attemptCount,
    previousTier: status.state === 'previous_tier_closed' ? previousTier : null,
  };
}

function recipeCard(r: RecipeView, balances: Balances, topics: ReadonlyMap<string, TopicLite>): RecipeCard {
  const items = r.items.map((it) => ({
    topic: topics.get(it.tokenTopicId) ?? { ...it.topic },
    minDifficulty: it.minDifficulty,
    need: it.need,
    have: it.have,
    missing: it.missing,
  }));
  let spend: SpendLine[] | null = null;
  if (r.ready) {
    const plan = planDebits(
      balances,
      r.items.map((it) => ({ topicId: it.tokenTopicId, quantity: it.need, minDifficulty: it.minDifficulty }))
    );
    if (plan.ok) {
      spend = plan.debits
        .map((d) => ({ topic: topics.get(d.topicId) ?? { id: d.topicId, slug: '', title: d.topicId, icon: 'coin' }, difficulty: d.difficulty, amount: d.amount }))
        .sort((a, b) => a.topic.title.localeCompare(b.topic.title) || difficultyRank(a.difficulty) - difficultyRank(b.difficulty));
    }
  }
  return { id: r.recipeId, title: r.title, ord: r.ord, missing: r.missing, totalQuantity: r.totalQuantity, ready: r.ready, items, spend };
}

function cardState(t: MapTopic): TopicCardState {
  if (t.status === 'unlocked') return 'unlocked';
  if (t.status === 'unlockable') return 'unlockable';
  if (t.blocker?.kind === 'gate') return 'tier_closed';
  if (t.blocker?.kind === 'no_recipe') return 'no_recipe';
  return 'needs_tokens';
}

/**
 * Everything /map renders: tiers (open state, gate card), topics (state,
 * balances per difficulty bucket, recipes with have/need and — when ready —
 * the exact debits, the problems they hold), "what's blocking you" with
 * ways to earn the missing tokens, and the running gate attempt. Lazily
 * finishes expired attempts.
 */
export async function getMapView(userId: string, now: Date = new Date()): Promise<MapView> {
  const map = await getMapState(userId, now);
  const topics = new Map<string, TopicLite>(
    map.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, { id: topic.id, slug: topic.slug, title: topic.title, icon: topic.icon }]))
  );
  const balances: Balances = Object.fromEntries(map.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, topic.balance.byDifficulty])));
  const unlocked = new Set(map.tiers.flatMap((t) => t.topics.filter((topic) => topic.status === 'unlocked').map((topic) => topic.id)));

  const [earnable, gates, recipeTitles, problems] = await Promise.all([
    loadEarnableQuestions(userId, unlocked),
    prisma.gate.findMany({
      select: {
        id: true,
        questions: { orderBy: { ord: 'asc' }, select: { question: { select: { slug: true, title: true, difficulty: true } } } },
      },
    }),
    prisma.unlockRecipe.findMany({
      where: { id: { in: map.tiers.flatMap((t) => t.topics.map((topic) => topic.unlock?.viaRecipeId).filter((id): id is string => !!id)) } },
      select: { id: true, title: true },
    }),
    listTopicProblems(userId, now),
  ]);
  const gateQuestions = new Map(gates.map((g) => [g.id, g.questions.map((q) => q.question)]));
  // This learner's solved problems, by question — for the gates' "n solved" and the page's total.
  const solvedSlugs = new Set<string>();
  const solvedIds = new Set<string>();
  for (const list of [...problems.byTopic.values(), problems.unfiled]) {
    for (const p of list) {
      if (p.progress !== 'solved') continue;
      solvedSlugs.add(p.slug);
      solvedIds.add(p.id);
    }
  }
  const recipeTitle = new Map(recipeTitles.map((r) => [r.id, r.title]));
  const problemView = (p: TopicProblem): TopicProblemView => ({
    slug: p.slug,
    title: p.title,
    difficulty: p.difficulty,
    progress: p.progress,
    needs: p.open ? [] : p.topicIds.filter((id) => !unlocked.has(id)).flatMap((id) => topics.get(id) ?? []),
  });

  const gateQuestionsOf = (gateId: string) => gateQuestions.get(gateId) ?? [];
  const solvedOf = (gateId: string) => gateQuestionsOf(gateId).filter((q) => solvedSlugs.has(q.slug)).length;

  const tiers: TierView[] = map.tiers.map((tier, i) => {
    const previous = i > 0 ? map.tiers[i - 1] : null;
    return {
      id: tier.id,
      ord: tier.ord,
      slug: tier.slug,
      title: tier.title,
      summary: tier.summary,
      open: tier.open,
      gate: tier.gate ? gateCard(tier.gate, gateQuestionsOf(tier.gate.gate.id), previous ? { slug: previous.slug, title: previous.title } : null, solvedOf(tier.gate.gate.id)) : null,
      topics: tier.topics.map((t): TopicCardView => {
        const recipes = t.recipes.map((r) => recipeCard(r, balances, topics));
        let blocker: TopicBlockerView | null = null;
        if (t.blocker?.kind === 'gate') {
          const g = t.blocker.gate;
          blocker = {
            kind: 'gate',
            tier: { slug: t.blocker.tier.slug, title: t.blocker.tier.title },
            gate: g
              ? { id: g.gate.id, title: g.gate.title, state: g.state, nextEligibleAt: iso(g.nextEligibleAt), attemptId: g.runningAttempt?.id ?? null }
              : null,
            previousTier: previous ? { slug: previous.slug, title: previous.title } : null,
          };
        } else if (t.blocker?.kind === 'recipe') {
          const cheapestId = t.blocker.cheapest.recipeId;
          const cheapest = recipes.find((r) => r.id === cheapestId) ?? recipes[0];
          blocker = {
            kind: 'recipe',
            recipeId: cheapest.id,
            recipeTitle: cheapest.title,
            missing: cheapest.missing,
            ready: cheapest.ready,
            items: cheapest.items.map((it) => ({
              ...it,
              earn: it.missing > 0 ? earnOptionsFor({ topicId: it.topic.id, minDifficulty: it.minDifficulty }, earnable) : [],
            })),
          };
        } else if (t.blocker?.kind === 'no_recipe') {
          blocker = { kind: 'no_recipe' };
        }
        const held = problems.byTopic.get(t.id) ?? [];
        return {
          id: t.id,
          slug: t.slug,
          title: t.title,
          icon: t.icon,
          summary: t.summary,
          state: cardState(t),
          unlockedAt: iso(t.unlock?.at),
          viaRecipe: t.unlock?.viaRecipeId ? recipeTitle.get(t.unlock.viaRecipeId) ?? null : null,
          balance: t.balance,
          recipes,
          blocker,
          problems: {
            total: held.length,
            solved: held.filter((p) => p.progress === 'solved').length,
            list: t.status === 'unlocked' ? held.map(problemView) : [],
          },
        };
      }),
    };
  });

  let running: MapView['running'] = null;
  const runningGate = map.tiers.map((t) => t.gate).find((g) => g?.runningAttempt);
  if (runningGate?.runningAttempt) {
    const view = await getGateAttempt(userId, runningGate.runningAttempt.id, now);
    if (view.running) {
      running = {
        attemptId: view.attempt.id,
        gateTitle: view.gate.title,
        tierTitle: runningGate.tier.title,
        deadlineAt: view.attempt.deadlineAt.toISOString(),
        solved: view.questions.filter((q) => q.solved).length,
        total: view.questions.length,
        passThreshold: view.gate.passThreshold,
      };
    }
  }

  const allTopics = tiers.flatMap((t) => t.topics);
  return {
    tiers,
    unfiled: problems.unfiled.map(problemView),
    totals: {
      tokens: allTopics.reduce((s, t) => s + t.balance.total, 0),
      topicsUnlocked: allTopics.filter((t) => t.state === 'unlocked').length,
      topicsTotal: allTopics.length,
      tiersOpen: tiers.filter((t) => t.open).length,
      tiersTotal: tiers.length,
      solved: solvedIds.size,
    },
    running,
  };
}

// ─── Gate attempt page ───────────────────────────────────────────────────

export interface GateAttemptPageView {
  attemptId: string;
  gate: {
    id: string;
    title: string;
    summary: string;
    passThreshold: number;
    cooldownHours: number;
    timeLimitMinutes: number;
    questionCount: number;
  };
  tier: { slug: string; title: string; open: boolean };
  running: boolean;
  startedAt: string;
  deadlineAt: string;
  finishedAt: string | null;
  passed: boolean | null;
  passedCount: number;
  nextEligibleAt: string | null;
  questions: { slug: string; title: string; difficulty: Difficulty; solved: boolean }[];
  solvedCount: number;
  /** The gate's state now (e.g. `eligible` again once a cooldown ran out). */
  gateState: GateState;
  /** A newer attempt of this gate exists. */
  superseded: boolean;
}

/**
 * One gate attempt for its page: countdown data, questions with live
 * solved state, and — once finished (explicitly or lazily past the
 * deadline) — the result. Throws NotFoundError for someone else's attempt.
 */
export async function getGateAttemptView(userId: string, attemptId: string, now: Date = new Date()): Promise<GateAttemptPageView> {
  const view = await getGateAttempt(userId, attemptId, now);
  const [tier, status] = await Promise.all([
    prisma.tier.findUnique({ where: { id: view.gate.tierId }, select: { slug: true, title: true } }),
    getGateStatus(userId, view.gate.id, now),
  ]);
  if (!tier) throw new NotFoundError('tier', view.gate.tierId);
  const { attempt } = view;
  const newest = status.runningAttempt ?? status.lastAttempt;
  return {
    attemptId: attempt.id,
    gate: {
      id: view.gate.id,
      title: view.gate.title,
      summary: view.gate.summary,
      passThreshold: view.gate.passThreshold,
      cooldownHours: view.gate.cooldownHours,
      timeLimitMinutes: view.gate.timeLimitMinutes,
      questionCount: view.gate.questionCount,
    },
    tier: { slug: tier.slug, title: tier.title, open: status.state === 'passed' },
    running: view.running,
    startedAt: attempt.startedAt.toISOString(),
    deadlineAt: attempt.deadlineAt.toISOString(),
    finishedAt: iso(attempt.finishedAt),
    passed: attempt.passed,
    passedCount: attempt.passedCount,
    nextEligibleAt: iso(attempt.nextEligibleAt),
    questions: view.questions.map((q) => ({
      slug: q.slug,
      title: q.title,
      difficulty: q.difficulty as Difficulty,
      solved: q.solved,
    })),
    solvedCount: view.questions.filter((q) => q.solved).length,
    gateState: status.state,
    superseded: !!newest && newest.id !== attempt.id && newest.startedAt.getTime() > attempt.startedAt.getTime(),
  };
}
