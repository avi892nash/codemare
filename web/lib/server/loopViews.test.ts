import { describe, expect, it } from 'vitest';
import { unlockTopic } from './access';
import { finishGate, startGate } from './gates';
import { earnOptionsFor, getGateAttemptView, getMapView, getTokenTotal } from './loopViews';
import { NotFoundError } from './errors';
import { prisma, setupTestDatabase } from './test/db';
import { grant, makeHints, makeQuestion, makeRecipe, makeSubmission, makeUser, makeWorld, openTier } from './test/factories';

describe('earnOptionsFor (pure)', () => {
  const questions = [
    { id: 'a', slug: 'a', title: 'A', difficulty: 'Easy' as const, award: [{ topicId: 't', amount: 1 }] },
    { id: 'b', slug: 'b', title: 'B', difficulty: 'Hard' as const, award: [{ topicId: 't', amount: 3 }] },
    { id: 'c', slug: 'c', title: 'C', difficulty: 'Medium' as const, award: [{ topicId: 'u', amount: 2 }] },
    { id: 'd', slug: 'd', title: 'D', difficulty: 'Medium' as const, award: [{ topicId: 't', amount: 2 }] },
    { id: 'e', slug: 'e', title: 'E', difficulty: 'Easy' as const, award: [{ topicId: 't', amount: 1 }] },
  ];

  it('lists questions paying the topic at or above the minimum, most tokens first, at most three', () => {
    expect(earnOptionsFor({ topicId: 't', minDifficulty: 'Easy' }, questions)).toEqual([
      { slug: 'b', title: 'B', difficulty: 'Hard', amount: 3 },
      { slug: 'd', title: 'D', difficulty: 'Medium', amount: 2 },
      { slug: 'a', title: 'A', difficulty: 'Easy', amount: 1 },
    ]);
    expect(earnOptionsFor({ topicId: 't', minDifficulty: 'Hard' }, questions).map((o) => o.slug)).toEqual(['b']);
    expect(earnOptionsFor({ topicId: 'none', minDifficulty: 'Easy' }, questions)).toEqual([]);
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

      expect(map.totals).toEqual({ tokens: 0, topicsUnlocked: 2, topicsTotal: 4, tiersOpen: 1, tiersTotal: 2, problems: 2, solved: 0 });
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
        solvedCount: 0,
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
      expect(item?.earn).toEqual([{ slug: 'arrays-medium', title: 'arrays-medium', difficulty: 'Medium', amount: 2 }]);
    });

    it('leaves out questions whose solve already paid, and applies hint penalties to the rest', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      await openTier(user.id, w.tier1.id);
      await makeRecipe(w.dp.id, [{ topicId: w.arrays.id, quantity: 5 }], { title: 'Many arrays' });
      const paid = await makeQuestion({ slug: 'arrays-paid', difficulty: 'Hard', topics: [{ topicId: w.arrays.id }] });
      const hinted = await makeQuestion({ slug: 'arrays-hinted', difficulty: 'Hard', topics: [{ topicId: w.arrays.id }] });
      await prisma.tokenLedger.create({
        data: { userId: user.id, topicId: w.arrays.id, amount: 3, sourceDifficulty: 'Hard', reason: 'solve', refType: 'question', refId: paid.id },
      });
      const hints = await makeHints({ questionId: hinted.id }, [{ level: 'nudge', costAmount: 40 }]);
      await prisma.hintUse.create({
        data: { userId: user.id, hintId: hints.nudge.id, questionId: hinted.id, costKind: 'score', costAmount: 40 },
      });

      const dp = (await getMapView(user.id)).tiers[1].topics.find((t) => t.slug === 'dp')!;
      const item = dp.blocker?.kind === 'recipe' ? dp.blocker.items[0] : null;
      expect(item).toMatchObject({ need: 5, have: 3, missing: 2 });
      // arrays-paid already paid out; arrays-hinted pays round(3 × 0.6) = 2.
      expect(item?.earn).toEqual([
        { slug: 'arrays-hinted', title: 'arrays-hinted', difficulty: 'Hard', amount: 2 },
        { slug: 'q-arrays', title: 'q-arrays', difficulty: 'Easy', amount: 1 },
      ]);
    });

    it('lists an unlocked topic’s problems with this learner’s progress, and counts a locked topic’s', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      // q-arrays (from the world) is solved; arrays-medium was attempted; the composite also needs graphs.
      await makeQuestion({ slug: 'arrays-medium', difficulty: 'Medium', topics: [{ topicId: w.arrays.id }] });
      await makeQuestion({ slug: 'arrays-graphs', difficulty: 'Hard', topics: [{ topicId: w.arrays.id }, { topicId: w.graphs.id, weight: 0.5 }] });
      await makeQuestion({ slug: 'graphs-only', difficulty: 'Medium', topics: [{ topicId: w.graphs.id }] });
      await makeQuestion({ slug: 'arrays-draft', status: 'draft', topics: [{ topicId: w.arrays.id }] });
      await makeSubmission(user.id, { questionId: w.q1.id, kind: 'submit', status: 'OK' });
      const medium = await prisma.question.findUniqueOrThrow({ where: { slug: 'arrays-medium' } });
      await makeSubmission(user.id, { questionId: medium.id, kind: 'run', status: 'WA' });

      const map = await getMapView(user.id);
      const arrays = map.tiers[0].topics.find((t) => t.slug === 'arrays')!;
      expect(arrays.problems).toEqual({
        total: 3,
        solved: 1,
        list: [
          { slug: 'q-arrays', title: 'q-arrays', difficulty: 'Easy', progress: 'solved', needs: [] },
          { slug: 'arrays-medium', title: 'arrays-medium', difficulty: 'Medium', progress: 'attempted', needs: [] },
          // Open only once graphs is unlocked too: the card says so instead of linking it.
          {
            slug: 'arrays-graphs',
            title: 'arrays-graphs',
            difficulty: 'Hard',
            progress: 'todo',
            needs: [{ id: w.graphs.id, slug: 'graphs', title: 'graphs', icon: 'grid' }],
          },
        ],
      });
      // A locked topic shows how many problems it holds, composites included — no list.
      const graphs = map.tiers[1].topics.find((t) => t.slug === 'graphs')!;
      expect(graphs.state).toBe('tier_closed');
      expect(graphs.problems).toEqual({ total: 2, solved: 0, list: [] });
      expect(map.tiers[1].topics.find((t) => t.slug === 'dp')!.problems).toEqual({ total: 0, solved: 0, list: [] });
      expect(map.unfiled).toEqual([]);

      // Unlocking graphs opens the composite (and lists graphs’ own problems).
      await openTier(user.id, w.tier1.id);
      await prisma.unlock.create({ data: { userId: user.id, kind: 'topic', refId: w.graphs.id } });
      const after = await getMapView(user.id);
      expect(after.tiers[0].topics.find((t) => t.slug === 'arrays')!.problems.list[2]).toMatchObject({ slug: 'arrays-graphs', needs: [] });
      expect(after.tiers[1].topics.find((t) => t.slug === 'graphs')!.problems.list.map((p) => p.slug)).toEqual([
        'arrays-graphs',
        'graphs-only',
      ]);
    });

    it('lists published questions without a topic on their own', async () => {
      await makeWorld();
      const user = await makeUser();
      await makeQuestion({ slug: 'no-topic', difficulty: 'Medium' });
      const map = await getMapView(user.id);
      expect(map.unfiled).toEqual([{ slug: 'no-topic', title: 'no-topic', difficulty: 'Medium', progress: 'todo', needs: [] }]);
    });

    it('counts the problems solved so far, in total and among a gate’s own (the first-run card and the gate nudge read them)', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      await makeQuestion({ slug: 'arrays-extra', topics: [{ topicId: w.arrays.id }] });
      const fresh = await getMapView(user.id);
      expect(fresh.totals.solved).toBe(0);
      expect(fresh.tiers[1].gate).toMatchObject({ solvedCount: 0 });

      // An accepted submit counts once however often it is repeated; a failed one and a run do not count.
      await makeSubmission(user.id, { questionId: w.q1.id, kind: 'submit', status: 'OK' });
      await makeSubmission(user.id, { questionId: w.q1.id, kind: 'submit', status: 'OK' });
      const extra = await prisma.question.findUniqueOrThrow({ where: { slug: 'arrays-extra' } });
      await makeSubmission(user.id, { questionId: extra.id, kind: 'submit', status: 'WA' });
      const one = await getMapView(user.id);
      expect(one.totals.solved).toBe(1);
      // q-arrays is one of the gate's two problems, solved outside any attempt: it counts toward the nudge.
      expect(one.tiers[1].gate).toMatchObject({ solvedCount: 1, questionCount: 2 });

      await makeSubmission(user.id, { questionId: extra.id, kind: 'submit', status: 'OK' });
      const two = await getMapView(user.id);
      expect(two.totals.solved).toBe(2);
      expect(two.tiers[1].gate).toMatchObject({ solvedCount: 1 });
    });

    it('counts every published problem once, a composite too (the header says “n/30 problems solved”)', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      expect((await getMapView(user.id)).totals).toMatchObject({ problems: 2, solved: 0 });
      await makeQuestion({ slug: 'arrays-graphs', difficulty: 'Hard', topics: [{ topicId: w.arrays.id }, { topicId: w.graphs.id, weight: 0.5 }] });
      await makeQuestion({ slug: 'no-topic' });
      await makeQuestion({ slug: 'a-draft', status: 'draft', topics: [{ topicId: w.arrays.id }] });
      await makeSubmission(user.id, { questionId: w.q1.id, kind: 'submit', status: 'OK' });
      // two topics' lists hold the composite, the unfiled list holds the loose one: 2 + 1 + 1, drafts out
      expect((await getMapView(user.id)).totals).toMatchObject({ problems: 4, solved: 1 });
    });

    it('names the unlocked topic of the problem touched last — a run counts, the latest wins (its row opens on the map)', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      expect((await getMapView(user.id)).lastTouchedTopic).toBeNull();

      const now = Date.now();
      await makeSubmission(user.id, { questionId: w.q1.id, kind: 'submit', status: 'OK', createdAt: new Date(now - 3000) });
      await makeSubmission(user.id, { questionId: w.q2.id, kind: 'run', status: 'WA', createdAt: new Date(now - 2000) });
      expect((await getMapView(user.id)).lastTouchedTopic).toBe('strings');
      await makeSubmission(user.id, { questionId: w.q1.id, kind: 'submit', status: 'WA', createdAt: new Date(now - 1000) });
      expect((await getMapView(user.id)).lastTouchedTopic).toBe('arrays');
    });

    it('takes the heaviest topic of the problem that is open, never a locked one (its row has no problems to show)', async () => {
      const w = await makeWorld();
      const user = await makeUser();
      const now = Date.now();
      // graphs weighs more but is locked: the composite sits in arrays' list too, and that row is the one to open
      const composite = await makeQuestion({ slug: 'graphs-arrays', topics: [{ topicId: w.graphs.id, weight: 2 }, { topicId: w.arrays.id, weight: 1 }] });
      await makeSubmission(user.id, { questionId: composite.id, kind: 'run', status: 'WA', createdAt: new Date(now - 2000) });
      expect((await getMapView(user.id)).lastTouchedTopic).toBe('arrays');

      // a problem of locked topics only (reachable through a gate attempt): nothing to open
      const gated = await makeQuestion({ slug: 'graphs-only', topics: [{ topicId: w.graphs.id }] });
      await makeSubmission(user.id, { questionId: gated.id, kind: 'gate', status: 'WA', createdAt: new Date(now - 1000) });
      expect((await getMapView(user.id)).lastTouchedTopic).toBeNull();

      // …until the topic is open
      await openTier(user.id, w.tier1.id);
      await prisma.unlock.create({ data: { userId: user.id, kind: 'topic', refId: w.graphs.id } });
      expect((await getMapView(user.id)).lastTouchedTopic).toBe('graphs');
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
