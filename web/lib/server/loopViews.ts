import 'server-only';
import { BUILD_LANGUAGES, DIFFICULTIES, type Difficulty, type Signature, type SupportedLanguage } from '@/lib/types';
import { canAccessBuildStep, getMapState, type MapTopic, type RecipeView } from './access';
import { getLibrary } from './components';
import { prisma } from './db';
import { AccessDenied, InvalidInput, NotFoundError } from './errors';
import { getGateAttempt, getGateStatus, type GateState, type GateStatus } from './gates';
import { getTopicBalances } from './ledger';
import { isStepDone, loadEarnables, questionServesWant, type EarnableBuild, type EarnableQuestion } from './queue';
import { difficultyRank, meetsMinDifficulty, planDebits, type Balances } from './rules/recipes';
import { parseJsonColumn, predictPayloadSchema } from './schemas';

/**
 * View models for the learning-loop pages — /map (T1), the gate attempt
 * page, /queue's predict step (T2a) and /me/library (T3) — plus the navbar
 * token total. Every rule comes from the domain layer (getMapState,
 * planDebits, getGateAttempt, getLibrary, …); this module only joins and
 * shapes, and returns JSON-safe data (dates as ISO strings) so pages can
 * hand it straight to client components.
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

/** A way to earn a missing token: a question to solve or a build step to pass. */
export type EarnOption =
  | { kind: 'question'; slug: string; title: string; difficulty: Difficulty; amount: number }
  | { kind: 'build'; stepId: string; title: string; componentTitle: string; difficulty: Difficulty; amount: number };

export type TopicBlockerView =
  | {
      kind: 'gate';
      tier: { slug: string; title: string };
      gate: { id: string; title: string; state: GateState; nextEligibleAt: string | null; attemptId: string | null } | null;
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
  totals: { tokens: number; topicsUnlocked: number; topicsTotal: number; tiersOpen: number; tiersTotal: number };
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
const EARN_BUILDS = 1;

/** Questions and builds that pay qualifying tokens of `topicId`, best first. */
export function earnOptionsFor(
  item: { topicId: string; minDifficulty: Difficulty },
  earnables: { questions: readonly EarnableQuestion[]; builds: readonly EarnableBuild[] }
): EarnOption[] {
  const questions = earnables.questions
    .map((q) => ({ q, amount: questionServesWant(q, item) }))
    .filter((x) => x.amount > 0)
    .sort(
      (a, b) =>
        b.amount - a.amount ||
        difficultyRank(a.q.difficulty) - difficultyRank(b.q.difficulty) ||
        a.q.title.localeCompare(b.q.title)
    )
    .slice(0, EARN_QUESTIONS)
    .map(({ q, amount }): EarnOption => ({ kind: 'question', slug: q.slug, title: q.title, difficulty: q.difficulty, amount }));
  const builds = earnables.builds
    .filter((b) => b.topicId === item.topicId && !b.waiting && meetsMinDifficulty(b.difficulty, item.minDifficulty))
    .sort((a, b) => b.amount - a.amount || a.componentTitle.localeCompare(b.componentTitle))
    .slice(0, EARN_BUILDS)
    .map(
      (b): EarnOption => ({
        kind: 'build',
        stepId: b.stepId,
        title: b.title,
        componentTitle: b.componentTitle,
        difficulty: b.difficulty,
        amount: b.amount,
      })
    );
  return [...questions, ...builds];
}

function gateCard(status: GateStatus, questions: GateCardView['questions'], previousTier: GateCardView['previousTier']): GateCardView {
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
 * the exact debits), "what's blocking you" with ways to earn the missing
 * tokens, and the running gate attempt. Lazily finishes expired attempts.
 */
export async function getMapView(userId: string, now: Date = new Date()): Promise<MapView> {
  const map = await getMapState(userId, now);
  const topics = new Map<string, TopicLite>(
    map.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, { id: topic.id, slug: topic.slug, title: topic.title, icon: topic.icon }]))
  );
  const balances: Balances = Object.fromEntries(map.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, topic.balance.byDifficulty])));
  const unlocked = new Set(map.tiers.flatMap((t) => t.topics.filter((topic) => topic.status === 'unlocked').map((topic) => topic.id)));

  const [earnables, gates, recipeTitles] = await Promise.all([
    loadEarnables(userId, unlocked),
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
  ]);
  const gateQuestions = new Map(gates.map((g) => [g.id, g.questions.map((q) => q.question)]));
  const recipeTitle = new Map(recipeTitles.map((r) => [r.id, r.title]));

  const tiers: TierView[] = map.tiers.map((tier, i) => {
    const previous = i > 0 ? map.tiers[i - 1] : null;
    return {
      id: tier.id,
      ord: tier.ord,
      slug: tier.slug,
      title: tier.title,
      summary: tier.summary,
      open: tier.open,
      gate: tier.gate
        ? gateCard(tier.gate, gateQuestions.get(tier.gate.gate.id) ?? [], previous ? { slug: previous.slug, title: previous.title } : null)
        : null,
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
              earn: it.missing > 0 ? earnOptionsFor({ topicId: it.topic.id, minDifficulty: it.minDifficulty }, earnables) : [],
            })),
          };
        } else if (t.blocker?.kind === 'no_recipe') {
          blocker = { kind: 'no_recipe' };
        }
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
    totals: {
      tokens: allTopics.reduce((s, t) => s + t.balance.total, 0),
      topicsUnlocked: allTopics.filter((t) => t.state === 'unlocked').length,
      topicsTotal: allTopics.length,
      tiersOpen: tiers.filter((t) => t.open).length,
      tiersTotal: tiers.length,
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

// ─── /queue: the predict step (T2a) ──────────────────────────────────────

export interface PredictStepView {
  stepId: string;
  title: string;
  promptMd: string;
  difficulty: Difficulty;
  language: SupportedLanguage;
  code: string;
  question: string;
  /** Multiple choice; null → free answer. */
  choices: string[] | null;
  /** Once answered: their answer and the reveal. Never present before — the answer stays on the server. */
  result: { answer: string; correct: boolean; expected: string; explanationMd: string } | null;
}

/**
 * A predict step for the queue: the snippet and the question, without the
 * answer until the learner has predicted. Throws AccessDenied (topic
 * locked), NotFoundError, InvalidInput (a build step).
 */
export async function getPredictStepView(userId: string, stepId: string): Promise<PredictStepView> {
  const access = await canAccessBuildStep(userId, stepId);
  if (!access.ok) throw new AccessDenied('topic_locked', 'Unlock this component’s topic on the map first.');
  const [step, progress] = await Promise.all([
    prisma.buildStep.findUnique({
      where: { id: stepId },
      select: { id: true, kind: true, title: true, promptMd: true, difficulty: true, payload: true },
    }),
    prisma.stepProgress.findUnique({
      where: { userId_buildStepId: { userId, buildStepId: stepId } },
      select: { status: true, answer: true, correct: true },
    }),
  ]);
  if (!step) throw new NotFoundError('build step', stepId);
  if (step.kind !== 'predict') throw new InvalidInput('not a predict step');
  const payload = parseJsonColumn(predictPayloadSchema, step.payload, `build_steps.payload (${stepId})`);
  const answered = progress && progress.status !== 'seen' && typeof progress.answer === 'string';
  return {
    stepId: step.id,
    title: step.title,
    promptMd: step.promptMd,
    difficulty: step.difficulty,
    language: payload.language,
    code: payload.code,
    question: payload.question,
    choices: payload.choices ?? null,
    result: answered
      ? {
          answer: progress.answer as string,
          correct: progress.correct === true,
          expected: payload.answer,
          explanationMd: payload.explanation_md,
        }
      : null,
  };
}

// ─── /me/library (T3) ────────────────────────────────────────────────────

export interface LibraryVersionView {
  versionId: string;
  /** 1-based, per component and language, oldest first. */
  number: number;
  language: SupportedLanguage;
  passed: boolean;
  createdAt: string;
  submissionId: string;
}

export interface LibraryComponentView {
  id: string;
  slug: string;
  title: string;
  summaryMd: string;
  functionName: string;
  signature: Signature;
  topic: TopicLite & { unlocked: boolean };
  built: boolean;
  /** Latest passing version per language, in the build-language order. */
  latest: { language: SupportedLanguage; versionId: string; number: number; createdAt: string; code: string; submissionId: string | null }[];
  /** Every version, newest first. */
  history: LibraryVersionView[];
  dependsOn: { slug: string; title: string; built: boolean }[];
  usedBy: { slug: string; title: string; built: boolean }[];
  steps: { passed: number; total: number };
  /** Where to rebuild it in the queue (its first build step). */
  rebuildStepId: string | null;
  /** Its first step not done yet, for "Build it" links. */
  nextStepId: string | null;
}

export interface MyLibraryView {
  built: LibraryComponentView[];
  /** Components not built yet, in map order. */
  unbuilt: LibraryComponentView[];
  totals: { built: number; total: number; versions: number; languages: SupportedLanguage[] };
}

/**
 * The learner's components: latest passing code per language, version
 * history, what each depends on and what depends on it (spec §4 prelude
 * order is the dependency order shown), and where to rebuild it.
 */
export async function getMyLibraryView(userId: string): Promise<MyLibraryView> {
  const [library, versions, steps, progress] = await Promise.all([
    getLibrary(userId),
    prisma.componentVersion.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, componentId: true, language: true, passed: true, createdAt: true, submissionId: true },
    }),
    prisma.buildStep.findMany({ select: { id: true, componentId: true, ord: true, kind: true } }),
    prisma.stepProgress.findMany({ where: { userId }, select: { buildStepId: true, status: true } }),
  ]);
  const status = new Map(progress.map((p) => [p.buildStepId, p.status]));
  const builtIds = new Set(library.filter((c) => c.built).map((c) => c.id));

  const numbered = new Map<string, LibraryVersionView[]>();
  const counter = new Map<string, number>();
  for (const v of versions) {
    const key = `${v.componentId}\u0000${v.language}`;
    const n = (counter.get(key) ?? 0) + 1;
    counter.set(key, n);
    const list = numbered.get(v.componentId) ?? [];
    list.push({
      versionId: v.id,
      number: n,
      language: v.language,
      passed: v.passed,
      createdAt: v.createdAt.toISOString(),
      submissionId: v.submissionId,
    });
    numbered.set(v.componentId, list);
  }

  const views = library.map((c): LibraryComponentView => {
    const history = [...(numbered.get(c.id) ?? [])].reverse();
    const numberOf = new Map(history.map((h) => [h.versionId, h]));
    const own = steps.filter((s) => s.componentId === c.id).sort((a, b) => a.ord - b.ord);
    const pending = own.find((s) => !isStepDone(s.kind, status.get(s.id)));
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      summaryMd: c.summaryMd,
      functionName: c.functionName,
      signature: c.signature,
      topic: c.topic,
      built: c.built,
      latest: BUILD_LANGUAGES.flatMap((language) => {
        const v = c.versions[language];
        if (!v) return [];
        const meta = numberOf.get(v.versionId);
        return [
          {
            language,
            versionId: v.versionId,
            number: meta?.number ?? 1,
            createdAt: v.createdAt.toISOString(),
            code: v.code,
            submissionId: meta?.submissionId ?? null,
          },
        ];
      }),
      history,
      dependsOn: c.dependsOn.map((d) => ({ slug: d.slug, title: d.title, built: builtIds.has(d.id) })),
      usedBy: library
        .filter((other) => other.dependsOn.some((d) => d.id === c.id))
        .map((other) => ({ slug: other.slug, title: other.title, built: other.built })),
      steps: c.steps,
      rebuildStepId: own.find((s) => s.kind === 'build')?.id ?? null,
      nextStepId: pending?.id ?? null,
    };
  });

  const languages = BUILD_LANGUAGES.filter((l) => views.some((v) => v.latest.some((x) => x.language === l)));
  return {
    built: views.filter((v) => v.built),
    unbuilt: views.filter((v) => !v.built),
    totals: {
      built: views.filter((v) => v.built).length,
      total: views.length,
      versions: versions.length,
      languages: [...languages],
    },
  };
}

// ─── helpers shared with pages ───────────────────────────────────────────

/** Difficulties easiest first — for bucket rows. */
export const BUCKETS: readonly Difficulty[] = DIFFICULTIES;

/** A component's signature as one line: `prefixSums(nums: int[]) → int[]`. */
export function signatureLine(functionName: string, signature: Signature): string {
  return `${functionName}(${signature.params.map((p) => `${p.name}: ${p.type}`).join(', ')}) → ${signature.returns}`;
}
