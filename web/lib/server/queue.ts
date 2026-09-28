import 'server-only';
import { BUILD_LANGUAGES, type BuildStepKind, type Difficulty, type SupportedLanguage } from '@/lib/types';
import { getMapState, type MapState } from './access';
import { prisma } from './db';
import { graphFromEdges, topologicalOrder } from './rules/graph';
import { scorePenaltyFrom } from './rules/hints';
import { difficultyRank, meetsMinDifficulty } from './rules/recipes';
import { buildAward, solveAward } from './rules/scoring';

/**
 * The learner's queue (/queue, artboards T2a/T2b): the predict and build
 * steps of every component in an unlocked topic, dependencies first — a
 * component whose dependencies aren't built yet waits — then suggested
 * questions (and an open gate) to earn what the map is waiting on.
 *
 * `planQueue` is the pure ordering rule; `getQueue` loads it for a user and
 * shapes it for the page. Access, tokens and awards all come from the domain
 * layer (unlocks, rules/scoring, getMapState) — nothing is re-derived here.
 */

// ─── Pure planning ───────────────────────────────────────────────────────

export type StepProgressStatus = 'seen' | 'predicted' | 'passed';

/** A predict step is done once answered (right or wrong); a build step once it passed. */
export function isStepDone(kind: BuildStepKind, status: StepProgressStatus | undefined): boolean {
  if (!status) return false;
  return kind === 'predict' ? status === 'predicted' || status === 'passed' : status === 'passed';
}

export interface PlanStep {
  id: string;
  ord: number;
  kind: BuildStepKind;
}

export interface PlanComponent {
  id: string;
  slug: string;
  topicId: string;
  /** Map order: [tier ord, topic ord, component ord]. */
  sortKey: readonly [number, number, number];
  /** Direct dependencies (component ids). */
  dependsOn: readonly string[];
  steps: readonly PlanStep[];
}

export interface PlanInput {
  components: readonly PlanComponent[];
  unlockedTopicIds: ReadonlySet<string>;
  /** build step id → the learner's progress on it. */
  progress: ReadonlyMap<string, StepProgressStatus>;
  /** Components with a passing version in some language. */
  built: ReadonlySet<string>;
}

export type ComponentQueueState = 'ready' | 'waiting' | 'done';
export type WaitReason = 'not_built' | 'topic_locked';

export interface PlannedComponent {
  id: string;
  state: ComponentQueueState;
  /** In step order, with whether each is done. */
  steps: { id: string; kind: BuildStepKind; done: boolean }[];
  /** waiting: the direct dependencies that have no passing version yet. */
  waitingOn: { id: string; reason: WaitReason }[];
}

export interface QueuePlan {
  /** Components of unlocked topics, dependencies first (map order among equals). */
  components: PlannedComponent[];
  /** Pending steps of ready components, in queue order. `upNext[0]` is the current step. */
  upNext: { stepId: string; componentId: string }[];
  /** Components whose topic is still locked, in map order. */
  locked: string[];
}

function compareSortKey(a: PlanComponent, b: PlanComponent): number {
  return (
    a.sortKey[0] - b.sortKey[0] ||
    a.sortKey[1] - b.sortKey[1] ||
    a.sortKey[2] - b.sortKey[2] ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  );
}

/**
 * Order the queue. Components of unlocked topics go dependencies-first
 * (topological order, ties in map order: tier → topic → component). Each
 * is `done` when all its steps are, `waiting` while a direct dependency
 * has no passing version, else `ready`. The pending steps of ready
 * components, in step order, form `upNext` — its head is what to do now.
 * Components without steps are left out (there is nothing to do in them).
 * Throws DependencyCycle for cyclic content.
 */
export function planQueue(input: PlanInput): QueuePlan {
  const withSteps = input.components.filter((c) => c.steps.length > 0);
  const byId = new Map(input.components.map((c) => [c.id, c]));
  const mapOrder = [...withSteps].sort(compareSortKey);
  const rank = new Map(mapOrder.map((c, i) => [c.id, i]));
  const open = mapOrder.filter((c) => input.unlockedTopicIds.has(c.topicId));
  const graph = graphFromEdges(
    input.components.flatMap((c) => c.dependsOn.map((d) => ({ from: c.id, dependsOn: d }))),
    input.components.map((c) => c.id)
  );
  const order = topologicalOrder(
    graph,
    open.map((c) => c.id),
    (id) => rank.get(id) ?? 0
  );

  const components: PlannedComponent[] = order.map((id) => {
    const c = byId.get(id)!;
    const steps = [...c.steps]
      .sort((a, b) => a.ord - b.ord || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((s) => ({ id: s.id, kind: s.kind, done: isStepDone(s.kind, input.progress.get(s.id)) }));
    const waitingOn = [...new Set(c.dependsOn)]
      .filter((dep) => !input.built.has(dep))
      .map((dep) => {
        const topicId = byId.get(dep)?.topicId;
        const reason: WaitReason = topicId !== undefined && !input.unlockedTopicIds.has(topicId) ? 'topic_locked' : 'not_built';
        return { id: dep, reason };
      });
    const state: ComponentQueueState = steps.every((s) => s.done) ? 'done' : waitingOn.length > 0 ? 'waiting' : 'ready';
    return { id, state, steps, waitingOn: state === 'waiting' ? waitingOn : [] };
  });

  const upNext = components
    .filter((c) => c.state === 'ready')
    .flatMap((c) => c.steps.filter((s) => !s.done).map((s) => ({ stepId: s.id, componentId: c.id })));

  return {
    components,
    upNext,
    locked: mapOrder.filter((c) => !input.unlockedTopicIds.has(c.topicId)).map((c) => c.id),
  };
}

// ─── Earning suggestions (pure) ──────────────────────────────────────────

/** A published question every topic of which is unlocked, whose first solve hasn't paid out yet. */
export interface EarnableQuestion {
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** Max tier ord over its topics. */
  tierOrd: number;
  topics: { id: string; slug: string; title: string }[];
  /** What the first accepted submit would pay now (hint penalty applied). */
  award: { topicId: string; amount: number }[];
}

/** A build step of an unlocked topic's component that hasn't passed yet. */
export interface EarnableBuild {
  stepId: string;
  title: string;
  componentId: string;
  componentTitle: string;
  topicId: string;
  difficulty: Difficulty;
  amount: number;
  /** Its component waits on unbuilt dependencies. */
  waiting: boolean;
}

/** Tokens the map is waiting for: a missing item of a locked topic's cheapest recipe. */
export interface TokenWant {
  topicId: string;
  topicTitle: string;
  minDifficulty: Difficulty;
  missing: number;
  /** The locked topic it would help unlock. */
  forTopic: { slug: string; title: string };
}

/** Does `q` pay tokens that count for `want` (right topic, difficulty ≥ the item's minimum)? */
export function questionServesWant(q: Pick<EarnableQuestion, 'difficulty' | 'award'>, want: Pick<TokenWant, 'topicId' | 'minDifficulty'>): number {
  if (!meetsMinDifficulty(q.difficulty, want.minDifficulty)) return 0;
  return q.award.find((a) => a.topicId === want.topicId)?.amount ?? 0;
}

export interface RankedQuestion extends EarnableQuestion {
  /** The first want it serves, if any. */
  serves: TokenWant | null;
}

/**
 * Suggested questions, best first: those paying tokens a locked topic's
 * cheapest recipe is missing (most of them first), then the rest — each
 * group by tier, difficulty, then title.
 */
export function rankSuggestedQuestions(questions: readonly EarnableQuestion[], wants: readonly TokenWant[], limit = 5): RankedQuestion[] {
  const ranked = questions
    .filter((q) => q.award.some((a) => a.amount > 0))
    .map((q) => {
      let serves: TokenWant | null = null;
      let best = 0;
      for (const w of wants) {
        const amount = Math.min(questionServesWant(q, w), w.missing);
        if (amount > best) {
          best = amount;
          serves = w;
        }
      }
      return { q: { ...q, serves }, best };
    });
  ranked.sort(
    (a, b) =>
      b.best - a.best ||
      a.q.tierOrd - b.q.tierOrd ||
      difficultyRank(a.q.difficulty) - difficultyRank(b.q.difficulty) ||
      a.q.title.localeCompare(b.q.title)
  );
  return ranked.slice(0, limit).map((r) => r.q);
}

/** The missing items of every locked topic's cheapest recipe, in topics whose tier is open. */
export function tokenWants(map: MapState): TokenWant[] {
  const out: TokenWant[] = [];
  for (const tier of map.tiers) {
    for (const topic of tier.topics) {
      const b = topic.blocker;
      if (topic.status === 'unlocked' || b?.kind !== 'recipe' || b.cheapest.ready) continue;
      for (const item of b.cheapest.items) {
        if (item.missing <= 0) continue;
        out.push({
          topicId: item.tokenTopicId,
          topicTitle: item.topic.title,
          minDifficulty: item.minDifficulty,
          missing: item.missing,
          forTopic: { slug: topic.slug, title: topic.title },
        });
      }
    }
  }
  return out;
}

// ─── Loading ─────────────────────────────────────────────────────────────

/** Everything the learner could earn tokens with right now. */
export async function loadEarnables(
  userId: string,
  unlockedTopicIds: ReadonlySet<string>,
  opts: { progress?: ReadonlyMap<string, StepProgressStatus>; built?: ReadonlySet<string> } = {}
): Promise<{ questions: EarnableQuestion[]; builds: EarnableBuild[] }> {
  const [questions, paid, hintUses, steps, progressRows, builtRows] = await Promise.all([
    prisma.question.findMany({
      where: { status: 'published' },
      select: {
        id: true,
        slug: true,
        title: true,
        difficulty: true,
        topics: {
          select: { topicId: true, weight: true, topic: { select: { slug: true, title: true, tier: { select: { ord: true } } } } },
        },
      },
    }),
    prisma.tokenLedger.findMany({
      where: { userId, reason: 'solve', refType: 'question', amount: { gt: 0 } },
      distinct: ['refId'],
      select: { refId: true },
    }),
    prisma.hintUse.findMany({
      where: { userId, costKind: 'score' },
      select: { questionId: true, buildStepId: true, costKind: true, costAmount: true },
    }),
    prisma.buildStep.findMany({
      where: { kind: 'build', component: { topicId: { in: [...unlockedTopicIds] } } },
      select: {
        id: true,
        title: true,
        difficulty: true,
        component: { select: { id: true, title: true, topicId: true, deps: { select: { dependsOnId: true } } } },
      },
    }),
    opts.progress ? null : prisma.stepProgress.findMany({ where: { userId }, select: { buildStepId: true, status: true } }),
    opts.built
      ? null
      : prisma.componentVersion.findMany({ where: { userId, passed: true }, distinct: ['componentId'], select: { componentId: true } }),
  ]);

  const paidIds = new Set(paid.map((p) => p.refId));
  const usesOf = (key: 'questionId' | 'buildStepId', id: string) => hintUses.filter((u) => u[key] === id);
  const progress = opts.progress ?? new Map(progressRows!.map((r) => [r.buildStepId, r.status]));
  const built = opts.built ?? new Set(builtRows!.map((r) => r.componentId));

  const earnableQuestions: EarnableQuestion[] = questions
    .filter((q) => !paidIds.has(q.id) && q.topics.length > 0 && q.topics.every((t) => unlockedTopicIds.has(t.topicId)))
    .map((q) => ({
      id: q.id,
      slug: q.slug,
      title: q.title,
      difficulty: q.difficulty,
      tierOrd: Math.max(...q.topics.map((t) => t.topic.tier.ord)),
      topics: q.topics.map((t) => ({ id: t.topicId, slug: t.topic.slug, title: t.topic.title })),
      award: solveAward(q.difficulty, q.topics, scorePenaltyFrom(usesOf('questionId', q.id))),
    }))
    .filter((q) => q.award.length > 0);

  const builds: EarnableBuild[] = steps
    .filter((s) => progress.get(s.id) !== 'passed')
    .map((s) => ({
      stepId: s.id,
      title: s.title,
      componentId: s.component.id,
      componentTitle: s.component.title,
      topicId: s.component.topicId,
      difficulty: s.difficulty,
      amount: buildAward(s.difficulty, scorePenaltyFrom(usesOf('buildStepId', s.id))),
      waiting: s.component.deps.some((d) => !built.has(d.dependsOnId)),
    }))
    .filter((b) => b.amount > 0);

  return { questions: earnableQuestions, builds };
}

// ─── The page's view ─────────────────────────────────────────────────────

export interface QueueTopic {
  slug: string;
  title: string;
  icon: string;
}

export interface QueueStepView {
  stepId: string;
  kind: BuildStepKind;
  title: string;
  difficulty: Difficulty;
  done: boolean;
  /** 1-based position within its component, and the component's step count. */
  index: number;
  count: number;
}

export interface QueueComponentView {
  id: string;
  slug: string;
  title: string;
  topic: QueueTopic;
  state: ComponentQueueState;
  steps: QueueStepView[];
  /** waiting: what it waits on. */
  waitingOn: { slug: string; title: string; reason: WaitReason; topicTitle: string | null }[];
  /** Languages the learner has a passing version in. */
  builtLanguages: SupportedLanguage[];
  /** Direct dependencies, with the languages each is built in. */
  dependencies: { slug: string; title: string; builtLanguages: SupportedLanguage[] }[];
}

/** One pending step, with its component — an entry of "Up next". */
export interface QueueEntry extends QueueStepView {
  component: { id: string; slug: string; title: string; topic: QueueTopic };
}

export type QueueSuggestion =
  | {
      kind: 'question';
      slug: string;
      title: string;
      difficulty: Difficulty;
      topics: { slug: string; title: string }[];
      award: { topic: string; amount: number }[];
      /** Why it's suggested: the locked topic it counts toward. */
      reason: string | null;
    }
  | {
      kind: 'gate';
      gateId: string;
      title: string;
      tierTitle: string;
      tierSlug: string;
      state: 'eligible' | 'running';
      attemptId: string | null;
      /** ISO — running only. */
      deadlineAt: string | null;
      passThreshold: number;
      questionCount: number;
      timeLimitMinutes: number;
    };

export interface QueueView {
  /** The step to do now (null once every ready step is done). */
  current: QueueEntry | null;
  /** Every pending step of a ready component, current first. */
  upNext: QueueEntry[];
  components: QueueComponentView[];
  /** Components of locked topics, grouped by topic (map order). */
  locked: { topic: QueueTopic & { tierTitle: string; tierOpen: boolean }; components: { slug: string; title: string }[] }[];
  /** After the steps: an open gate, then questions that earn what the map is waiting for. */
  suggestions: QueueSuggestion[];
  totals: { stepsDone: number; stepsTotal: number; componentsDone: number; componentsTotal: number };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The learner's queue: planned steps, waiting and locked components, and
 * suggestions. Lazily finishes expired gate attempts (through getMapState).
 */
export async function getQueue(userId: string, now: Date = new Date()): Promise<QueueView> {
  const [rows, progressRows, versionRows, map] = await Promise.all([
    prisma.component.findMany({
      select: {
        id: true,
        slug: true,
        title: true,
        ord: true,
        topicId: true,
        topic: { select: { slug: true, title: true, icon: true, ord: true, tier: { select: { ord: true, title: true } } } },
        deps: { select: { dependsOnId: true } },
        buildSteps: { select: { id: true, ord: true, kind: true, title: true, difficulty: true } },
      },
    }),
    prisma.stepProgress.findMany({ where: { userId }, select: { buildStepId: true, status: true } }),
    prisma.componentVersion.findMany({
      where: { userId, passed: true },
      distinct: ['componentId', 'language'],
      select: { componentId: true, language: true },
    }),
    getMapState(userId, now),
  ]);

  const topicState = new Map(map.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, { unlocked: topic.status === 'unlocked', tier: t }])));
  const unlockedTopicIds = new Set([...topicState].filter(([, v]) => v.unlocked).map(([id]) => id));
  const progress = new Map(progressRows.map((r) => [r.buildStepId, r.status as StepProgressStatus]));
  const languagesOf = new Map<string, SupportedLanguage[]>();
  for (const v of versionRows) languagesOf.set(v.componentId, [...(languagesOf.get(v.componentId) ?? []), v.language]);
  const orderLanguages = (ls: SupportedLanguage[] = []) => BUILD_LANGUAGES.filter((l) => ls.includes(l)) as SupportedLanguage[];
  const built = new Set(languagesOf.keys());

  const plan = planQueue({
    components: rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      topicId: c.topicId,
      sortKey: [c.topic.tier.ord, c.topic.ord, c.ord] as const,
      dependsOn: c.deps.map((d) => d.dependsOnId),
      steps: c.buildSteps.map((s) => ({ id: s.id, ord: s.ord, kind: s.kind })),
    })),
    unlockedTopicIds,
    progress,
    built,
  });

  const byId = new Map(rows.map((c) => [c.id, c]));
  const topicOf = (c: (typeof rows)[number]): QueueTopic => ({ slug: c.topic.slug, title: c.topic.title, icon: c.topic.icon });

  const components: QueueComponentView[] = plan.components.map((p) => {
    const c = byId.get(p.id)!;
    const stepMeta = new Map(c.buildSteps.map((s) => [s.id, s]));
    return {
      id: c.id,
      slug: c.slug,
      title: c.title,
      topic: topicOf(c),
      state: p.state,
      steps: p.steps.map((s, i) => ({
        stepId: s.id,
        kind: s.kind,
        title: stepMeta.get(s.id)!.title,
        difficulty: stepMeta.get(s.id)!.difficulty,
        done: s.done,
        index: i + 1,
        count: p.steps.length,
      })),
      waitingOn: p.waitingOn.map((w) => {
        const dep = byId.get(w.id);
        return {
          slug: dep?.slug ?? w.id,
          title: dep?.title ?? w.id,
          reason: w.reason,
          topicTitle: w.reason === 'topic_locked' ? dep?.topic.title ?? null : null,
        };
      }),
      builtLanguages: orderLanguages(languagesOf.get(c.id)),
      dependencies: [...new Set(c.deps.map((d) => d.dependsOnId))].map((id) => ({
        slug: byId.get(id)?.slug ?? id,
        title: byId.get(id)?.title ?? id,
        builtLanguages: orderLanguages(languagesOf.get(id)),
      })),
    };
  });

  const viewById = new Map(components.map((c) => [c.id, c]));
  const upNext: QueueEntry[] = plan.upNext.map(({ stepId, componentId }) => {
    const c = viewById.get(componentId)!;
    const step = c.steps.find((s) => s.stepId === stepId)!;
    return { ...step, component: { id: c.id, slug: c.slug, title: c.title, topic: c.topic } };
  });

  const lockedGroups = new Map<string, QueueView['locked'][number]>();
  for (const id of plan.locked) {
    const c = byId.get(id)!;
    const state = topicState.get(c.topicId);
    const group = lockedGroups.get(c.topicId) ?? {
      topic: { ...topicOf(c), tierTitle: c.topic.tier.title, tierOpen: state?.tier.open ?? false },
      components: [],
    };
    group.components.push({ slug: c.slug, title: c.title });
    lockedGroups.set(c.topicId, group);
  }

  const suggestions: QueueSuggestion[] = [];
  const openGate = map.tiers.map((t) => t.gate).find((g) => g && (g.state === 'eligible' || g.state === 'running'));
  if (openGate) {
    suggestions.push({
      kind: 'gate',
      gateId: openGate.gate.id,
      title: openGate.gate.title,
      tierTitle: openGate.tier.title,
      tierSlug: openGate.tier.slug,
      state: openGate.state as 'eligible' | 'running',
      attemptId: openGate.runningAttempt?.id ?? null,
      deadlineAt: openGate.runningAttempt?.deadlineAt.toISOString() ?? null,
      passThreshold: openGate.gate.passThreshold,
      questionCount: openGate.gate.questionCount,
      timeLimitMinutes: openGate.gate.timeLimitMinutes,
    });
  }
  const { questions } = await loadEarnables(userId, unlockedTopicIds, { progress, built });
  const titleOf = new Map(map.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, topic.title])));
  for (const q of rankSuggestedQuestions(questions, tokenWants(map))) {
    suggestions.push({
      kind: 'question',
      slug: q.slug,
      title: q.title,
      difficulty: q.difficulty,
      topics: q.topics.map((t) => ({ slug: t.slug, title: t.title })),
      award: q.award.map((a) => ({ topic: titleOf.get(a.topicId) ?? '', amount: a.amount })),
      reason: q.serves
        ? `Counts toward ${q.serves.forTopic.title}: ${plural(q.serves.missing, `more ${q.serves.topicTitle} token`)}${
            q.serves.minDifficulty === 'Easy' ? '' : ` (${q.serves.minDifficulty}+)`
          } needed.`
        : null,
    });
  }

  const allSteps = components.flatMap((c) => c.steps);
  return {
    current: upNext[0] ?? null,
    upNext,
    components,
    locked: [...lockedGroups.values()],
    suggestions,
    totals: {
      stepsDone: allSteps.filter((s) => s.done).length,
      stepsTotal: allSteps.length,
      componentsDone: components.filter((c) => c.state === 'done').length,
      componentsTotal: components.length,
    },
  };
}
