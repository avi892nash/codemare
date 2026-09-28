import { describe, expect, it } from 'vitest';
import { onBuildPassed } from './awards';
import { recordComponentVersion } from './components';
import { DependencyCycle } from './errors';
import {
  getQueue,
  isStepDone,
  planQueue,
  rankSuggestedQuestions,
  type EarnableQuestion,
  type PlanComponent,
  type PlanInput,
  type StepProgressStatus,
  type TokenWant,
} from './queue';
import { submitPrediction } from './steps';
import { prisma, setupTestDatabase } from './test/db';
import {
  makeBuildStep,
  makeComponent,
  makeQuestion,
  makeRecipe,
  makeSubmission,
  makeUser,
  makeWorld,
  openTier,
} from './test/factories';

// ─── planQueue (pure) ────────────────────────────────────────────────────

/** A component with a predict step (ord 0) and a build step (ord 1): ids `<id>.p`, `<id>.b`. */
function comp(id: string, opts: { topic?: string; key?: [number, number, number]; deps?: string[] } = {}): PlanComponent {
  return {
    id,
    slug: id,
    topicId: opts.topic ?? 't0',
    sortKey: opts.key ?? [0, 0, 0],
    dependsOn: opts.deps ?? [],
    steps: [
      { id: `${id}.b`, ord: 1, kind: 'build' },
      { id: `${id}.p`, ord: 0, kind: 'predict' },
    ],
  };
}

function input(components: PlanComponent[], over: Partial<PlanInput> = {}): PlanInput {
  return {
    components,
    unlockedTopicIds: new Set(['t0']),
    progress: new Map(),
    built: new Set(),
    ...over,
  };
}

const ids = (plan: ReturnType<typeof planQueue>) => plan.components.map((c) => c.id);
const next = (plan: ReturnType<typeof planQueue>) => plan.upNext.map((s) => s.stepId);

describe('isStepDone', () => {
  it('counts a predict step once answered and a build step once passed', () => {
    expect(isStepDone('predict', undefined)).toBe(false);
    expect(isStepDone('predict', 'seen')).toBe(false);
    expect(isStepDone('predict', 'predicted')).toBe(true);
    expect(isStepDone('build', 'seen')).toBe(false);
    expect(isStepDone('build', 'predicted')).toBe(false);
    expect(isStepDone('build', 'passed')).toBe(true);
  });
});

describe('planQueue: dependency order', () => {
  it('puts dependencies first and keeps map order among equals', () => {
    // Map order: range (0) < pal (1) < prefix (2), but range depends on prefix.
    const plan = planQueue(
      input([
        comp('prefix', { key: [0, 0, 2] }),
        comp('range', { key: [0, 0, 0], deps: ['prefix'] }),
        comp('pal', { key: [0, 0, 1] }),
      ])
    );
    expect(ids(plan)).toEqual(['pal', 'prefix', 'range']);
  });

  it('orders by tier, then topic, then component', () => {
    const plan = planQueue(
      input(
        [comp('c', { key: [1, 0, 0], topic: 't1' }), comp('b', { key: [0, 1, 0] }), comp('a', { key: [0, 0, 5] })],
        { unlockedTopicIds: new Set(['t0', 't1']) }
      )
    );
    expect(ids(plan)).toEqual(['a', 'b', 'c']);
  });

  it('lists each component’s steps in step order: predict before build', () => {
    const plan = planQueue(input([comp('a')]));
    expect(next(plan)).toEqual(['a.p', 'a.b']);
    expect(plan.components[0].steps.map((s) => s.kind)).toEqual(['predict', 'build']);
  });

  it('rejects a dependency cycle', () => {
    expect(() => planQueue(input([comp('a', { deps: ['b'] }), comp('b', { deps: ['a'] })]))).toThrow(DependencyCycle);
  });

  it('leaves out components without steps', () => {
    const empty: PlanComponent = { ...comp('empty'), steps: [] };
    expect(ids(planQueue(input([empty, comp('a')])))).toEqual(['a']);
  });
});

describe('planQueue: waiting items', () => {
  it('holds back a component whose dependency has no passing version', () => {
    const plan = planQueue(input([comp('prefix'), comp('range', { key: [0, 0, 1], deps: ['prefix'] }), comp('pal', { key: [0, 0, 2] })]));
    const range = plan.components.find((c) => c.id === 'range')!;
    expect(range).toMatchObject({ state: 'waiting', waitingOn: [{ id: 'prefix', reason: 'not_built' }] });
    // Waiting steps are not "up next": the queue skips to the next ready component.
    expect(next(plan)).toEqual(['prefix.p', 'prefix.b', 'pal.p', 'pal.b']);
  });

  it('says when the dependency is in a locked topic', () => {
    const plan = planQueue(
      input([comp('heap', { topic: 't1', key: [1, 0, 0] }), comp('dijkstra', { deps: ['heap'] })], {
        unlockedTopicIds: new Set(['t0']),
      })
    );
    expect(plan.components).toEqual([
      expect.objectContaining({ id: 'dijkstra', state: 'waiting', waitingOn: [{ id: 'heap', reason: 'topic_locked' }] }),
    ]);
    expect(plan.locked).toEqual(['heap']);
    expect(plan.upNext).toEqual([]);
  });

  it('keeps locked topics’ components out of the queue', () => {
    const plan = planQueue(input([comp('a'), comp('z', { topic: 't9', key: [2, 0, 0] })]));
    expect(ids(plan)).toEqual(['a']);
    expect(plan.locked).toEqual(['z']);
  });

  it('does not wait on a dependency that is built, even from a locked topic', () => {
    const plan = planQueue(
      input([comp('heap', { topic: 't1' }), comp('dijkstra', { deps: ['heap'] })], { built: new Set(['heap']) })
    );
    expect(plan.components[0]).toMatchObject({ id: 'dijkstra', state: 'ready', waitingOn: [] });
  });
});

describe('planQueue: advancing', () => {
  const world = [comp('prefix'), comp('range', { key: [0, 0, 1], deps: ['prefix'] }), comp('pal', { key: [0, 0, 2] })];

  it('moves the current step on as steps are done, and releases dependents after a build', () => {
    const progress = new Map<string, StepProgressStatus>();
    let plan = planQueue(input(world, { progress }));
    expect(plan.upNext[0]).toEqual({ stepId: 'prefix.p', componentId: 'prefix' });

    // A wrong prediction still completes the predict step.
    progress.set('prefix.p', 'predicted');
    plan = planQueue(input(world, { progress }));
    expect(plan.upNext[0].stepId).toBe('prefix.b');

    // Opening the build (seen) changes nothing.
    progress.set('prefix.b', 'seen');
    expect(planQueue(input(world, { progress })).upNext[0].stepId).toBe('prefix.b');

    // The build passes: prefix is done and built, so range — its dependent — comes next, before pal.
    progress.set('prefix.b', 'passed');
    plan = planQueue(input(world, { progress, built: new Set(['prefix']) }));
    expect(plan.components.map((c) => [c.id, c.state])).toEqual([
      ['prefix', 'done'],
      ['range', 'ready'],
      ['pal', 'ready'],
    ]);
    expect(next(plan)).toEqual(['range.p', 'range.b', 'pal.p', 'pal.b']);
  });

  it('keeps an unanswered predict step pending after its build passed out of order', () => {
    const plan = planQueue(
      input([comp('a')], { progress: new Map([['a.b', 'passed' as const]]), built: new Set(['a']) })
    );
    expect(plan.components[0].state).toBe('ready');
    expect(next(plan)).toEqual(['a.p']);
  });

  it('is empty when everything is done', () => {
    const plan = planQueue(
      input([comp('a')], {
        progress: new Map<string, StepProgressStatus>([
          ['a.p', 'predicted'],
          ['a.b', 'passed'],
        ]),
        built: new Set(['a']),
      })
    );
    expect(plan.components[0].state).toBe('done');
    expect(plan.upNext).toEqual([]);
  });
});

// ─── rankSuggestedQuestions (pure) ───────────────────────────────────────

function question(slug: string, difficulty: EarnableQuestion['difficulty'], award: [string, number][], tierOrd = 0): EarnableQuestion {
  return {
    id: slug,
    slug,
    title: slug,
    difficulty,
    tierOrd,
    topics: award.map(([id]) => ({ id, slug: id, title: id })),
    award: award.map(([topicId, amount]) => ({ topicId, amount })),
  };
}

describe('rankSuggestedQuestions', () => {
  const want: TokenWant = { topicId: 'stack', topicTitle: 'Stack', minDifficulty: 'Medium', missing: 2, forTopic: { slug: 'rec', title: 'Recursion' } };

  it('puts questions paying a wanted token first — only at or above the item’s difficulty', () => {
    const ranked = rankSuggestedQuestions(
      [
        question('easy-stack', 'Easy', [['stack', 1]]),
        question('arrays', 'Easy', [['arrays', 1]]),
        question('hard-stack', 'Hard', [['stack', 3]]),
      ],
      [want]
    );
    expect(ranked.map((q) => q.slug)).toEqual(['hard-stack', 'arrays', 'easy-stack']);
    expect(ranked[0].serves).toEqual(want);
    expect(ranked[2].serves).toBeNull();
  });

  it('orders the rest by tier, difficulty and title, and caps the list', () => {
    const ranked = rankSuggestedQuestions(
      [
        question('b', 'Medium', [['x', 2]]),
        question('a', 'Medium', [['x', 2]]),
        question('t1', 'Easy', [['y', 1]], 1),
        question('e', 'Easy', [['x', 1]]),
      ],
      [],
      3
    );
    expect(ranked.map((q) => q.slug)).toEqual(['e', 'a', 'b']);
  });

  it('skips questions that pay nothing', () => {
    expect(rankSuggestedQuestions([question('zero', 'Easy', [['x', 0]])], [])).toEqual([]);
  });
});

// ─── getQueue (DB) ───────────────────────────────────────────────────────

describe('getQueue', () => {
  setupTestDatabase();

  async function queueWorld() {
    const w = await makeWorld(); // tier 0: arrays, strings (q-arrays, q-strings); tier 1: graphs, dp (gate)
    const prefix = await makeComponent({ topicId: w.arrays.id, slug: 'prefix', ord: 0 });
    const range = await makeComponent({ topicId: w.arrays.id, slug: 'range', ord: 1, dependsOn: [prefix.id] });
    const bfs = await makeComponent({ topicId: w.graphs.id, slug: 'bfs', ord: 2 });
    const steps = {
      prefixP: await makeBuildStep(prefix.id, { kind: 'predict', ord: 0 }),
      prefixB: await makeBuildStep(prefix.id, { kind: 'build', ord: 1 }),
      rangeP: await makeBuildStep(range.id, { kind: 'predict', ord: 0 }),
      rangeB: await makeBuildStep(range.id, { kind: 'build', ord: 1 }),
      bfsB: await makeBuildStep(bfs.id, { kind: 'build', ord: 0 }),
    };
    return { ...w, prefix, range, bfs, steps };
  }

  /** What /api/build does on a passing build: submission → component version → awards. */
  async function passBuild(userId: string, stepId: string, componentId: string) {
    const sub = await makeSubmission(userId, { kind: 'build', buildStepId: stepId, status: 'OK', code: 'def f():\n    return 0' });
    await recordComponentVersion({ userId, componentId, language: 'python', code: 'def f():\n    return 0', passed: true, submissionId: sub.id });
    return onBuildPassed(userId, sub.id);
  }

  it('starts with the first ready component’s predict step; a dependent waits', async () => {
    const w = await queueWorld();
    const user = await makeUser();
    const q = await getQueue(user.id);
    expect(q.current).toMatchObject({ stepId: w.steps.prefixP.id, kind: 'predict', index: 1, count: 2, component: { slug: 'prefix' } });
    expect(q.upNext.map((s) => s.stepId)).toEqual([w.steps.prefixP.id, w.steps.prefixB.id]);
    expect(q.components.map((c) => [c.slug, c.state])).toEqual([
      ['prefix', 'ready'],
      ['range', 'waiting'],
    ]);
    expect(q.components[1].waitingOn).toEqual([{ slug: 'prefix', title: 'prefix', reason: 'not_built', topicTitle: null }]);
    // bfs is in a locked topic: listed under its topic, not queued.
    expect(q.locked).toEqual([
      { topic: expect.objectContaining({ slug: 'graphs', tierOpen: false }), components: [{ slug: 'bfs', title: 'bfs' }] },
    ]);
    expect(q.totals).toEqual({ stepsDone: 0, stepsTotal: 4, componentsDone: 0, componentsTotal: 2 });
  });

  it('advances after a prediction and after a passing build', async () => {
    const w = await queueWorld();
    const user = await makeUser();

    await submitPrediction(user.id, w.steps.prefixP.id, '2'); // wrong answer — still done
    expect((await getQueue(user.id)).current?.stepId).toBe(w.steps.prefixB.id);

    const awards = await passBuild(user.id, w.steps.prefixB.id, w.prefix.id);
    expect(awards.tokensAwarded).toEqual([{ topic: 'arrays', title: 'arrays', amount: 1 }]);

    const q = await getQueue(user.id);
    expect(q.current).toMatchObject({ stepId: w.steps.rangeP.id, component: { slug: 'range' } });
    expect(q.components.map((c) => [c.slug, c.state])).toEqual([
      ['prefix', 'done'],
      ['range', 'ready'],
    ]);
    expect(q.components[0].builtLanguages).toEqual(['python']);
    expect(q.components[1].dependencies).toEqual([{ slug: 'prefix', title: 'prefix', builtLanguages: ['python'] }]);
    expect(q.totals).toMatchObject({ stepsDone: 2, componentsDone: 1 });
  });

  it('queues a newly unlocked topic’s components', async () => {
    const w = await queueWorld();
    const user = await makeUser();
    await openTier(user.id, w.tier1.id);
    await prisma.unlock.create({ data: { userId: user.id, kind: 'topic', refId: w.graphs.id } });
    const q = await getQueue(user.id);
    expect(q.components.map((c) => c.slug)).toEqual(['prefix', 'range', 'bfs']);
    expect(q.upNext.map((s) => s.stepId)).toContain(w.steps.bfsB.id);
    expect(q.locked).toEqual([]);
  });

  it('suggests the open gate, then unearned questions — first those a locked topic’s recipe needs', async () => {
    const w = await queueWorld();
    const user = await makeUser();
    const extra = await makeQuestion({ slug: 'q-arrays-medium', difficulty: 'Medium', topics: [{ topicId: w.arrays.id }] });

    let q = await getQueue(user.id);
    expect(q.suggestions[0]).toMatchObject({ kind: 'gate', state: 'eligible', tierTitle: w.tier1.title, passThreshold: 2, questionCount: 2 });
    expect(q.suggestions.filter((s) => s.kind === 'question').map((s) => s.slug).sort()).toEqual(
      ['q-arrays', 'q-arrays-medium', 'q-strings'].sort()
    );

    // Tier 1 open; dp's only recipe wants 2 Medium+ arrays tokens.
    await openTier(user.id, w.tier1.id);
    await makeRecipe(w.dp.id, [{ topicId: w.arrays.id, quantity: 2, minDifficulty: 'Medium' }], { title: 'Arrays first' });
    q = await getQueue(user.id);
    expect(q.suggestions.some((s) => s.kind === 'gate')).toBe(false);
    const first = q.suggestions[0];
    expect(first).toMatchObject({ kind: 'question', slug: extra.slug, award: [{ topic: 'arrays', amount: 2 }] });
    expect(first.kind === 'question' && first.reason).toBe('Counts toward dp: 2 more arrays tokens (Medium+) needed.');

    // A question that already paid out is no longer suggested.
    await prisma.tokenLedger.create({
      data: { userId: user.id, topicId: w.arrays.id, amount: 2, sourceDifficulty: 'Medium', reason: 'solve', refType: 'question', refId: extra.id },
    });
    q = await getQueue(user.id);
    expect(q.suggestions.map((s) => (s.kind === 'question' ? s.slug : s.kind))).not.toContain(extra.slug);
  });
});
