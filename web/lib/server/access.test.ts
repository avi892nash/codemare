import { describe, expect, it } from 'vitest';
import {
  canAccessQuestion,
  getMapState,
  isTierOpen,
  isTopicUnlocked,
  questionAccessMap,
  unlockTopic,
  whatsBlocking,
} from './access';
import { InsufficientTokens, NotFoundError, TierLocked } from './errors';
import { prisma, setupTestDatabase } from './test/db';
import {
  balanceOf,
  grant,
  makeQuestion,
  makeRecipe,
  makeUser,
  makeWorld,
  openTier,
  unlockTopicRow,
} from './test/factories';

setupTestDatabase();

describe('tier 0 is free', () => {
  it('its tier is open and its topics unlocked without any rows', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    expect(await isTierOpen(user.id, w.tier0.id)).toBe(true);
    expect(await isTopicUnlocked(user.id, w.arrays.id)).toBe(true);
    expect(await isTierOpen(user.id, w.tier1.id)).toBe(false);
    expect(await isTopicUnlocked(user.id, w.graphs.id)).toBe(false);
    expect(await prisma.unlock.count()).toBe(0);
  });

  it('unlocking a tier-0 topic is a no-op', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const r = await unlockTopic(user.id, w.arrays.id);
    expect(r).toMatchObject({ status: 'already_unlocked', recipeId: null, debits: [] });
    expect(await prisma.unlock.count()).toBe(0);
  });
});

describe('unlockTopic', () => {
  it('refuses while the tier is closed (TierLocked), spending nothing', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const recipe = await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 1 }]);
    await grant(user.id, w.arrays.id, 'Easy', 5);
    await expect(unlockTopic(user.id, w.graphs.id, recipe.id)).rejects.toBeInstanceOf(TierLocked);
    expect(await balanceOf(user.id, w.arrays.id)).toBe(5);
  });

  it('spends the recipe and writes the unlock atomically', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await openTier(user.id, w.tier1.id);
    const recipe = await makeRecipe(w.graphs.id, [
      { topicId: w.arrays.id, quantity: 2 },
      { topicId: w.strings.id, quantity: 1, minDifficulty: 'Medium' },
    ]);
    await grant(user.id, w.arrays.id, 'Easy', 3);
    await grant(user.id, w.strings.id, 'Easy', 4);
    await grant(user.id, w.strings.id, 'Hard', 1);

    const r = await unlockTopic(user.id, w.graphs.id, recipe.id);

    expect(r.status).toBe('unlocked');
    expect(r.recipeId).toBe(recipe.id);
    expect(r.debits).toEqual(
      expect.arrayContaining([
        { topicId: w.arrays.id, difficulty: 'Easy', amount: 2 },
        { topicId: w.strings.id, difficulty: 'Hard', amount: 1 },
      ])
    );
    const unlock = await prisma.unlock.findFirstOrThrow({ where: { userId: user.id, kind: 'topic' } });
    expect(unlock).toMatchObject({ refId: w.graphs.id, viaRecipeId: recipe.id });
    const spends = await prisma.tokenLedger.findMany({ where: { amount: { lt: 0 } } });
    expect(spends.every((s) => s.reason === 'unlock' && s.refType === 'recipe' && s.refId === recipe.id)).toBe(true);
    expect(await isTopicUnlocked(user.id, w.graphs.id)).toBe(true);
    expect(await balanceOf(user.id, w.arrays.id)).toBe(1);
    expect(await balanceOf(user.id, w.strings.id)).toBe(4);
  });

  it('is idempotent once unlocked', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await openTier(user.id, w.tier1.id);
    const recipe = await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 1 }]);
    await grant(user.id, w.arrays.id, 'Easy', 3);
    await unlockTopic(user.id, w.graphs.id, recipe.id);
    const again = await unlockTopic(user.id, w.graphs.id, recipe.id);
    expect(again).toMatchObject({ status: 'already_unlocked', debits: [] });
    expect(await balanceOf(user.id, w.arrays.id)).toBe(2);
  });

  it('without a recipe id, spends the cheapest ready recipe', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await openTier(user.id, w.tier1.id);
    await makeRecipe(w.dp.id, [{ topicId: w.arrays.id, quantity: 5 }], { ord: 0, title: 'five arrays' });
    const cheap = await makeRecipe(w.dp.id, [{ topicId: w.strings.id, quantity: 2 }], { ord: 1, title: 'two strings' });
    await makeRecipe(w.dp.id, [{ topicId: w.graphs.id, quantity: 1 }], { ord: 2, title: 'one graph (unaffordable)' });
    await grant(user.id, w.arrays.id, 'Easy', 5);
    await grant(user.id, w.strings.id, 'Easy', 2);

    const r = await unlockTopic(user.id, w.dp.id);
    // Both ready (missing 0) → fewer total tokens wins.
    expect(r.recipeId).toBe(cheap.id);
    expect(await balanceOf(user.id, w.arrays.id)).toBe(5);
    expect(await balanceOf(user.id, w.strings.id)).toBe(0);
  });

  it('throws InsufficientTokens (nothing written) when no recipe is ready', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await openTier(user.id, w.tier1.id);
    await makeRecipe(w.dp.id, [{ topicId: w.arrays.id, quantity: 3 }]);
    await grant(user.id, w.arrays.id, 'Easy', 2);

    const err = await unlockTopic(user.id, w.dp.id).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientTokens);
    expect((err as InsufficientTokens).shortfalls).toEqual([{ topicId: w.arrays.id, minDifficulty: 'Easy', need: 3, have: 2 }]);
    expect(await prisma.unlock.count({ where: { kind: 'topic' } })).toBe(0);
    expect(await balanceOf(user.id, w.arrays.id)).toBe(2);
  });

  it("rejects another topic's recipe", async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await openTier(user.id, w.tier1.id);
    const other = await makeRecipe(w.dp.id, [{ topicId: w.arrays.id, quantity: 1 }]);
    await expect(unlockTopic(user.id, w.graphs.id, other.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("what's blocking you", () => {
  it('is the gate while the tier is closed (with eligibility)', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 1 }]);
    const b = await whatsBlocking(user.id, w.graphs.id);
    expect(b).toMatchObject({ kind: 'gate', tier: { id: w.tier1.id, ord: 1 }, gate: { state: 'eligible', eligible: true } });
  });

  it('is the cheapest recipe with per-item have/need once the tier is open', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await openTier(user.id, w.tier1.id);
    const r0 = await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 4 }], { ord: 0 });
    await makeRecipe(w.graphs.id, [{ topicId: w.strings.id, quantity: 3, minDifficulty: 'Medium' }], { ord: 1 });
    await grant(user.id, w.arrays.id, 'Easy', 3);
    await grant(user.id, w.strings.id, 'Easy', 3);

    const b = await whatsBlocking(user.id, w.graphs.id);
    expect(b?.kind).toBe('recipe');
    if (b?.kind !== 'recipe') return;
    expect(b.cheapest.recipeId).toBe(r0.id); // missing 1 vs missing 3
    expect(b.cheapest.items).toEqual([
      {
        tokenTopicId: w.arrays.id,
        minDifficulty: 'Easy',
        need: 4,
        have: 3,
        missing: 1,
        topic: { id: w.arrays.id, slug: 'arrays', title: 'arrays', icon: 'grid' },
      },
    ]);
    expect(b.recipes.map((r) => r.missing)).toEqual([1, 3]);
  });

  it('is null for an unlocked topic', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    expect(await whatsBlocking(user.id, w.arrays.id)).toBeNull();
    await openTier(user.id, w.tier1.id);
    await unlockTopicRow(user.id, w.graphs.id);
    expect(await whatsBlocking(user.id, w.graphs.id)).toBeNull();
  });
});

describe('getMapState', () => {
  it('returns every tier and topic with status and blocker', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 1 }]);
    await makeRecipe(w.dp.id, [{ topicId: w.arrays.id, quantity: 9 }]);
    await grant(user.id, w.arrays.id, 'Medium', 2);

    let map = await getMapState(user.id);
    expect(map.tiers.map((t) => [t.ord, t.open, t.gate?.state ?? null])).toEqual([
      [0, true, null],
      [1, false, 'eligible'],
    ]);
    expect(map.tiers[0].topics.map((t) => [t.slug, t.status, t.blocker])).toEqual([
      ['arrays', 'unlocked', null],
      ['strings', 'unlocked', null],
    ]);
    expect(map.tiers[0].topics[0].balance).toEqual({ total: 2, byDifficulty: { Easy: 0, Medium: 2, Hard: 0 } });
    expect(map.tiers[1].topics.map((t) => [t.slug, t.status, t.blocker?.kind])).toEqual([
      ['graphs', 'locked', 'gate'],
      ['dp', 'locked', 'gate'],
    ]);

    await openTier(user.id, w.tier1.id);
    map = await getMapState(user.id);
    expect(map.tiers[1].open).toBe(true);
    expect(map.tiers[1].gate?.state).toBe('passed');
    expect(map.tiers[1].topics.map((t) => [t.slug, t.status])).toEqual([
      ['graphs', 'unlockable'],
      ['dp', 'locked'],
    ]);

    await unlockTopic(user.id, w.graphs.id);
    map = await getMapState(user.id);
    const graphs = map.tiers[1].topics[0];
    expect(graphs.status).toBe('unlocked');
    expect(graphs.unlock?.viaRecipeId).toBeTruthy();
    expect(graphs.blocker).toBeNull();
  });
});

describe('question access', () => {
  it('needs every topic unlocked (composite questions too)', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const composite = await makeQuestion({ topics: [{ topicId: w.arrays.id }, { topicId: w.graphs.id }] });

    expect(await canAccessQuestion(user.id, w.q1.id)).toEqual({ ok: true, via: 'topics' });
    expect(await canAccessQuestion(user.id, composite.id)).toEqual({
      ok: false,
      reason: 'topic_locked',
      lockedTopics: [{ id: w.graphs.id, slug: 'graphs', title: 'graphs', icon: 'grid' }],
    });

    await openTier(user.id, w.tier1.id);
    await unlockTopicRow(user.id, w.graphs.id);
    expect(await canAccessQuestion(user.id, composite.id)).toEqual({ ok: true, via: 'topics' });
  });

  it('opens gate questions during a running attempt only', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const locked = await makeQuestion({ topics: [{ topicId: w.graphs.id }] });
    await prisma.gateQuestion.create({ data: { gateId: w.gate.id, questionId: locked.id, ord: 9 } });
    expect((await canAccessQuestion(user.id, locked.id)).ok).toBe(false);

    const now = new Date();
    const attempt = await prisma.gateAttempt.create({
      data: { userId: user.id, gateId: w.gate.id, startedAt: now, deadlineAt: new Date(now.getTime() + 3_600_000) },
    });
    expect(await canAccessQuestion(user.id, locked.id)).toEqual({ ok: true, via: 'gate_attempt', gateAttemptId: attempt.id });
    expect((await questionAccessMap(user.id, [locked.id])).get(locked.id)).toBe(true);

    const later = new Date(now.getTime() + 2 * 3_600_000);
    expect((await canAccessQuestion(user.id, locked.id, later)).ok).toBe(false);
  });

  it('hides drafts from everyone but their author and staff', async () => {
    const w = await makeWorld();
    const author = await makeUser({ role: 'author' });
    const learner = await makeUser();
    const staff = await makeUser({ role: 'staff' });
    const draft = await makeQuestion({ status: 'draft', authorId: author.id, topics: [{ topicId: w.arrays.id }] });
    expect(await canAccessQuestion(learner.id, draft.id)).toEqual({ ok: false, reason: 'draft' });
    expect(await canAccessQuestion(author.id, draft.id)).toEqual({ ok: true, via: 'author' });
    expect(await canAccessQuestion(staff.id, draft.id)).toEqual({ ok: true, via: 'author' });
  });

  it('batches access for the map’s problem lists', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const locked = await makeQuestion({ topics: [{ topicId: w.dp.id }] });
    const map = await questionAccessMap(user.id, [w.q1.id, w.q2.id, locked.id, 'missing']);
    expect(Object.fromEntries(map)).toEqual({ [w.q1.id]: true, [w.q2.id]: true, [locked.id]: false });
  });

  it('throws NotFoundError for an unknown question', async () => {
    const user = await makeUser();
    await expect(canAccessQuestion(user.id, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
