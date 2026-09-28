import { describe, expect, it } from 'vitest';
import { unlockTopic } from './access';
import { finishGate, startGate } from './gates';
import {
  earnOptionsFor,
  getGateAttemptView,
  getMapView,
  getMyLibraryView,
  getPredictStepView,
  getTokenTotal,
  signatureLine,
} from './loopViews';
import { AccessDenied, NotFoundError } from './errors';
import { submitPrediction } from './steps';
import { prisma, setupTestDatabase } from './test/db';
import {
  grant,
  makeBuildStep,
  makeComponent,
  makeQuestion,
  makeRecipe,
  makeSubmission,
  makeUser,
  makeWorld,
  openTier,
} from './test/factories';

describe('earnOptionsFor (pure)', () => {
  const questions = [
    { id: 'a', slug: 'a', title: 'A', difficulty: 'Easy' as const, tierOrd: 0, topics: [], award: [{ topicId: 't', amount: 1 }] },
    { id: 'b', slug: 'b', title: 'B', difficulty: 'Hard' as const, tierOrd: 0, topics: [], award: [{ topicId: 't', amount: 3 }] },
    { id: 'c', slug: 'c', title: 'C', difficulty: 'Medium' as const, tierOrd: 0, topics: [], award: [{ topicId: 'u', amount: 2 }] },
  ];
  const builds = [
    { stepId: 's1', title: 'Build x', componentId: 'x', componentTitle: 'X', topicId: 't', difficulty: 'Medium' as const, amount: 2, waiting: false },
    { stepId: 's2', title: 'Build y', componentId: 'y', componentTitle: 'Y', topicId: 't', difficulty: 'Medium' as const, amount: 2, waiting: true },
  ];

  it('lists questions paying the topic at or above the minimum, most tokens first, then a ready build', () => {
    expect(earnOptionsFor({ topicId: 't', minDifficulty: 'Easy' }, { questions, builds })).toEqual([
      { kind: 'question', slug: 'b', title: 'B', difficulty: 'Hard', amount: 3 },
      { kind: 'question', slug: 'a', title: 'A', difficulty: 'Easy', amount: 1 },
      { kind: 'build', stepId: 's1', title: 'Build x', componentTitle: 'X', difficulty: 'Medium', amount: 2 },
    ]);
    expect(earnOptionsFor({ topicId: 't', minDifficulty: 'Hard' }, { questions, builds }).map((o) => o.kind)).toEqual(['question']);
  });
});

describe('signatureLine (pure)', () => {
  it('prints a component signature on one line', () => {
    expect(signatureLine('prefixSums', { params: [{ name: 'nums', type: 'int[]' }], returns: 'int[]' })).toBe('prefixSums(nums: int[]) → int[]');
  });
});

describe('loop views (DB)', () => {
  setupTestDatabase();

  describe('getMapView', () => {
    it('shows a closed tier’s topics blocked by its gate, with the gate’s questions', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 1 }], { title: 'Scan' });
      const map = await getMapView(user.id);

      expect(map.totals).toEqual({ tokens: 0, topicsUnlocked: 2, topicsTotal: 4, tiersOpen: 1, tiersTotal: 2 });
      const [tier0, tier1] = map.tiers;
      expect(tier0).toMatchObject({ open: true, gate: null });
      expect(tier0.topics.map((t) => t.state)).toEqual(['unlocked', 'unlocked']);
      expect(tier1.gate).toMatchObject({
        state: 'eligible',
        eligible: true,
        passThreshold: 2,
        questions: [
          { slug: 'q-arrays', title: 'q-arrays', difficulty: 'Easy' },
          { slug: 'q-strings', title: 'q-strings', difficulty: 'Easy' },
        ],
        running: null,
        previousTier: null,
      });
      const graphs = tier1.topics.find((t) => t.slug === 'graphs')!;
      expect(graphs.state).toBe('tier_closed');
      expect(graphs.blocker).toMatchObject({ kind: 'gate', tier: { slug: w.tier1.slug }, gate: { state: 'eligible', attemptId: null } });
      // Recipes still show have/need while the tier is closed.
      expect(graphs.recipes[0]).toMatchObject({ title: 'Scan', ready: false, missing: 1, items: [{ need: 1, have: 0, missing: 1 }] });
      expect(map.running).toBeNull();
    });

    it('spells out the debits of a ready recipe, cheapest buckets first', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      await openTier(user.id, w.tier1.id);
      await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 2 }], { title: 'Two arrays' });
      await grant(user.id, w.arrays.id, 'Medium', 1);
      await grant(user.id, w.arrays.id, 'Easy', 1);
      await grant(user.id, w.arrays.id, 'Hard', 5);

      const graphs = (await getMapView(user.id)).tiers[1].topics.find((t) => t.slug === 'graphs')!;
      expect(graphs.state).toBe('unlockable');
      expect(graphs.balance.total).toBe(0);
      expect(graphs.recipes[0].spend).toEqual([
        { topic: expect.objectContaining({ slug: 'arrays' }), difficulty: 'Easy', amount: 1 },
        { topic: expect.objectContaining({ slug: 'arrays' }), difficulty: 'Medium', amount: 1 },
      ]);

      // …and that is what unlocking spends.
      const r = await unlockTopic(user.id, w.graphs.id, graphs.recipes[0].id);
      expect(r.debits).toEqual([
        { topicId: w.arrays.id, difficulty: 'Easy', amount: 1 },
        { topicId: w.arrays.id, difficulty: 'Medium', amount: 1 },
      ]);
      const after = (await getMapView(user.id)).tiers[1].topics.find((t) => t.slug === 'graphs')!;
      expect(after).toMatchObject({ state: 'unlocked', viaRecipe: 'Two arrays', blocker: null });
      expect(after.unlockedAt).toEqual(expect.any(String));
    });

    it('links the missing tokens of the cheapest recipe to questions that earn them', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      await openTier(user.id, w.tier1.id);
      await makeRecipe(w.dp.id, [{ topicId: w.arrays.id, quantity: 2, minDifficulty: 'Medium' }], { title: 'Medium arrays' });
      await makeQuestion({ slug: 'arrays-medium', difficulty: 'Medium', topics: [{ topicId: w.arrays.id }] });
      await makeQuestion({ slug: 'arrays-locked', difficulty: 'Hard', topics: [{ topicId: w.arrays.id }, { topicId: w.graphs.id }] });

      const dp = (await getMapView(user.id)).tiers[1].topics.find((t) => t.slug === 'dp')!;
      expect(dp.state).toBe('needs_tokens');
      expect(dp.blocker).toMatchObject({ kind: 'recipe', recipeTitle: 'Medium arrays', missing: 2, ready: false });
      const item = dp.blocker?.kind === 'recipe' ? dp.blocker.items[0] : null;
      // q-arrays (Easy) doesn't qualify for Medium+; arrays-locked needs graphs.
      expect(item?.earn).toEqual([{ kind: 'question', slug: 'arrays-medium', title: 'arrays-medium', difficulty: 'Medium', amount: 2 }]);
    });

    it('reports a running gate attempt with its progress', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      const attempt = await startGate(user.id, w.gate.id);
      await makeSubmission(user.id, { kind: 'gate', questionId: w.q1.id, gateAttemptId: attempt.id });
      const map = await getMapView(user.id);
      expect(map.running).toMatchObject({ attemptId: attempt.id, solved: 1, total: 2, passThreshold: 2 });
      expect(map.tiers[1].gate).toMatchObject({ state: 'running', running: { attemptId: attempt.id } });
    });
  });

  describe('getGateAttemptView', () => {
    it('shows live progress while running and the result once finished', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      const t0 = new Date(Date.now() - 5 * 60_000);
      const attempt = await startGate(user.id, w.gate.id, t0);
      await makeSubmission(user.id, { kind: 'gate', questionId: w.q1.id, gateAttemptId: attempt.id });

      let view = await getGateAttemptView(user.id, attempt.id);
      expect(view).toMatchObject({
        running: true,
        solvedCount: 1,
        passed: null,
        gateState: 'running',
        tier: { slug: w.tier1.slug, open: false },
        questions: [
          { slug: 'q-arrays', solved: true },
          { slug: 'q-strings', solved: false },
        ],
      });

      const result = await finishGate(user.id, attempt.id);
      expect(result).toMatchObject({ passed: false, passedCount: 1 });
      view = await getGateAttemptView(user.id, attempt.id);
      expect(view).toMatchObject({ running: false, passed: false, passedCount: 1, gateState: 'cooldown', superseded: false });
      expect(view.nextEligibleAt).toEqual(result.nextEligibleAt?.toISOString());
    });

    it('finishes an expired attempt lazily, and hides other people’s attempts', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      const other = await makeUser();
      const attempt = await startGate(user.id, w.gate.id, new Date(Date.now() - 2 * 60 * 60_000)); // 60-minute limit
      await makeSubmission(user.id, { kind: 'gate', questionId: w.q1.id, gateAttemptId: attempt.id, createdAt: new Date(Date.now() - 90 * 60_000) });
      await makeSubmission(user.id, { kind: 'gate', questionId: w.q2.id, gateAttemptId: attempt.id, createdAt: new Date(Date.now() - 80 * 60_000) });

      const view = await getGateAttemptView(user.id, attempt.id);
      expect(view).toMatchObject({ running: false, passed: true, passedCount: 2, gateState: 'passed', tier: { open: true } });
      await expect(getGateAttemptView(other.id, attempt.id)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('getPredictStepView', () => {
    it('keeps the answer on the server until the learner predicts', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      const c = await makeComponent({ topicId: w.arrays.id });
      const step = await makeBuildStep(c.id, { kind: 'predict' });

      const before = await getPredictStepView(user.id, step.id);
      expect(before).toMatchObject({ code: 'print(1)', question: 'Output?', choices: ['1', '2'], result: null });
      expect(JSON.stringify(before)).not.toContain('explanation');

      await submitPrediction(user.id, step.id, '1');
      const after = await getPredictStepView(user.id, step.id);
      expect(after.result).toEqual({ answer: '1', correct: true, expected: '1', explanationMd: '' });
    });

    it('refuses a locked topic’s step', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      const c = await makeComponent({ topicId: w.graphs.id });
      const step = await makeBuildStep(c.id, { kind: 'predict' });
      await expect(getPredictStepView(user.id, step.id)).rejects.toBeInstanceOf(AccessDenied);
    });
  });

  describe('getMyLibraryView', () => {
    async function version(userId: string, componentId: string, stepId: string, language: 'python' | 'javascript', passed: boolean, at: Date) {
      const sub = await makeSubmission(userId, { kind: 'build', buildStepId: stepId, status: passed ? 'OK' : 'WA', language, createdAt: at });
      return prisma.componentVersion.create({
        data: { userId, componentId, language, code: `// ${language} ${at.toISOString()}`, passed, submissionId: sub.id, createdAt: at },
      });
    }

    it('shows latest passing code per language, numbered history, dependencies and dependents', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      const prefix = await makeComponent({ topicId: w.arrays.id, slug: 'prefix', ord: 0 });
      const range = await makeComponent({ topicId: w.arrays.id, slug: 'range', ord: 1, dependsOn: [prefix.id] });
      await makeBuildStep(prefix.id, { kind: 'predict', ord: 0 });
      const prefixBuild = await makeBuildStep(prefix.id, { kind: 'build', ord: 1 });
      await makeBuildStep(range.id, { kind: 'build', ord: 0 });

      const day = (n: number) => new Date(Date.UTC(2026, 8, n));
      await version(user.id, prefix.id, prefixBuild.id, 'python', false, day(1));
      const py = await version(user.id, prefix.id, prefixBuild.id, 'python', true, day(2));
      const js = await version(user.id, prefix.id, prefixBuild.id, 'javascript', true, day(3));

      const lib = await getMyLibraryView(user.id);
      expect(lib.totals).toEqual({ built: 1, total: 2, versions: 3, languages: ['python', 'javascript'] });
      expect(lib.built.map((c) => c.slug)).toEqual(['prefix']);
      expect(lib.unbuilt.map((c) => c.slug)).toEqual(['range']);

      const p = lib.built[0];
      expect(p.latest.map((v) => [v.language, v.versionId, v.number])).toEqual([
        ['python', py.id, 2],
        ['javascript', js.id, 1],
      ]);
      expect(p.history.map((h) => [h.language, h.number, h.passed])).toEqual([
        ['javascript', 1, true],
        ['python', 2, true],
        ['python', 1, false],
      ]);
      expect(p.dependsOn).toEqual([]);
      expect(p.usedBy).toEqual([{ slug: 'range', title: 'range', built: false }]);
      expect(p.rebuildStepId).toBe(prefixBuild.id);
      expect(lib.unbuilt[0].dependsOn).toEqual([{ slug: 'prefix', title: 'prefix', built: true }]);
    });

    it('is empty for a new learner', async () => {
      await makeWorld();
      const user = await makeUser();
      const lib = await getMyLibraryView(user.id);
      expect(lib.built).toEqual([]);
      expect(lib.totals.versions).toBe(0);
    });
  });

  describe('getTokenTotal', () => {
    it('sums every topic balance, net of spends', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      await grant(user.id, w.arrays.id, 'Easy', 2);
      await grant(user.id, w.strings.id, 'Hard', 3);
      expect(await getTokenTotal(user.id)).toBe(5);
      await openTier(user.id, w.tier1.id);
      await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 2 }]);
      await unlockTopic(user.id, w.graphs.id);
      expect(await getTokenTotal(user.id)).toBe(3);
    });
  });
});
