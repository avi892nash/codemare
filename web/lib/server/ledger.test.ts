import { describe, expect, it } from 'vitest';
import { InsufficientTokens } from './errors';
import { earnForBuild, earnForSolve, getBalances, getScorePenalty, getTopicBalances, grantTokens, spend } from './ledger';
import { prisma, setupTestDatabase } from './test/db';
import {
  balanceOf,
  grant,
  makeBuildStep,
  makeComponent,
  makeHints,
  makeQuestion,
  makeTier,
  makeTopic,
  makeUser,
} from './test/factories';

setupTestDatabase();

async function setup() {
  const user = await makeUser();
  const tier = await makeTier(0);
  const a = await makeTopic(tier.id, { slug: 'arrays' });
  const b = await makeTopic(tier.id, { slug: 'graphs' });
  return { user, tier, a, b };
}

async function revealScoreHints(userId: string, questionId: string, costs: number[]) {
  const levels = ['nudge', 'concept', 'pseudo', 'line', 'solution'] as const;
  const hints = await makeHints(
    { questionId },
    costs.map((c, i) => ({ level: levels[i], costKind: 'score' as const, costAmount: c }))
  );
  for (let i = 0; i < costs.length; i++) {
    await prisma.hintUse.create({
      data: { userId, hintId: hints[levels[i]].id, questionId, costKind: 'score', costAmount: costs[i] },
    });
  }
}

describe('earnForSolve', () => {
  it('credits every question topic: round(BASE × weight), source = question difficulty', async () => {
    const { user, a, b } = await setup();
    const q = await makeQuestion({ difficulty: 'Hard', topics: [{ topicId: a.id, weight: 1 }, { topicId: b.id, weight: 0.5 }] });

    const awards = await earnForSolve(user.id, q.id);

    expect(awards.sort((x, y) => x.topicSlug.localeCompare(y.topicSlug))).toEqual([
      { topicId: a.id, topicSlug: 'arrays', topicTitle: 'arrays', amount: 3, sourceDifficulty: 'Hard' },
      { topicId: b.id, topicSlug: 'graphs', topicTitle: 'graphs', amount: 2, sourceDifficulty: 'Hard' },
    ]);
    const rows = await prisma.tokenLedger.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reason === 'solve' && r.refType === 'question' && r.refId === q.id)).toBe(true);
  });

  it('is idempotent: a second accept earns nothing', async () => {
    const { user, a } = await setup();
    const q = await makeQuestion({ difficulty: 'Medium', topics: [{ topicId: a.id }] });
    expect(await earnForSolve(user.id, q.id)).toHaveLength(1);
    expect(await earnForSolve(user.id, q.id)).toEqual([]);
    expect(await balanceOf(user.id, a.id)).toBe(2);
  });

  it('is idempotent under concurrent first accepts', async () => {
    const { user, a, b } = await setup();
    const q = await makeQuestion({ difficulty: 'Easy', topics: [{ topicId: a.id }, { topicId: b.id }] });
    const results = await Promise.all(Array.from({ length: 8 }, () => earnForSolve(user.id, q.id)));
    expect(results.flat()).toHaveLength(2);
    expect(await prisma.tokenLedger.count({ where: { userId: user.id } })).toBe(2);
  });

  it('applies the score penalty of revealed hints', async () => {
    const { user, a } = await setup();
    const q = await makeQuestion({ difficulty: 'Hard', topics: [{ topicId: a.id }] });
    await revealScoreHints(user.id, q.id, [0, 10, 25]); // 35%

    expect(await getScorePenalty(user.id, { questionId: q.id })).toBe(35);
    const [award] = await earnForSolve(user.id, q.id);
    expect(award.amount).toBe(2); // round(3 × 0.65) = round(1.95)
  });

  it('pays nothing once the penalty rounds the award to 0', async () => {
    const { user, a } = await setup();
    const q = await makeQuestion({ difficulty: 'Hard', topics: [{ topicId: a.id }] });
    await revealScoreHints(user.id, q.id, [0, 10, 25, 40, 100]); // capped at 100
    expect(await getScorePenalty(user.id, { questionId: q.id })).toBe(100);
    expect(await earnForSolve(user.id, q.id)).toEqual([]);
    expect(await prisma.tokenLedger.count()).toBe(0);
  });

  it('never pays for drafts', async () => {
    const { user, a } = await setup();
    const q = await makeQuestion({ status: 'draft', authorId: user.id, topics: [{ topicId: a.id }] });
    expect(await earnForSolve(user.id, q.id)).toEqual([]);
  });

  it('keeps users apart', async () => {
    const { user, a } = await setup();
    const other = await makeUser();
    const q = await makeQuestion({ topics: [{ topicId: a.id }] });
    await earnForSolve(user.id, q.id);
    expect(await earnForSolve(other.id, q.id)).toHaveLength(1);
  });
});

describe('earnForBuild', () => {
  it('pays BASE[step difficulty] to the component topic, once, penalty aware', async () => {
    const { user, a } = await setup();
    const component = await makeComponent({ topicId: a.id });
    const step = await makeBuildStep(component.id, { difficulty: 'Medium' });
    const hints = await makeHints({ buildStepId: step.id }, [{ level: 'nudge', costKind: 'score', costAmount: 25 }]);
    await prisma.hintUse.create({
      data: { userId: user.id, hintId: hints.nudge.id, buildStepId: step.id, costKind: 'score', costAmount: 25 },
    });

    const awards = await earnForBuild(user.id, step.id);
    expect(awards).toEqual([
      { topicId: a.id, topicSlug: 'arrays', topicTitle: 'arrays', amount: 2, sourceDifficulty: 'Medium' }, // round(1.5)
    ]);
    expect(await earnForBuild(user.id, step.id)).toEqual([]);
    const row = await prisma.tokenLedger.findFirstOrThrow({ where: { userId: user.id } });
    expect(row).toMatchObject({ reason: 'build', refType: 'build_step', refId: step.id });
  });

  it('never pays for predict steps', async () => {
    const { user, a } = await setup();
    const component = await makeComponent({ topicId: a.id });
    const step = await makeBuildStep(component.id, { kind: 'predict', difficulty: 'Hard' });
    expect(await earnForBuild(user.id, step.id)).toEqual([]);
  });
});

describe('spend', () => {
  it('debits qualifying buckets Easy → Medium → Hard, one negative row per bucket', async () => {
    const { user, a } = await setup();
    await grant(user.id, a.id, 'Easy', 2);
    await grant(user.id, a.id, 'Medium', 2);
    await grant(user.id, a.id, 'Hard', 2);

    const debits = await spend(
      user.id,
      [{ topicId: a.id, quantity: 3, minDifficulty: 'Easy' }],
      { reason: 'unlock', refType: 'recipe', refId: 'r1' }
    );
    expect(debits).toEqual([
      { topicId: a.id, difficulty: 'Easy', amount: 2 },
      { topicId: a.id, difficulty: 'Medium', amount: 1 },
    ]);
    const rows = await prisma.tokenLedger.findMany({ where: { userId: user.id, amount: { lt: 0 } }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.sourceDifficulty, r.amount, r.reason, r.refType, r.refId])).toEqual([
      ['Easy', -2, 'unlock', 'recipe', 'r1'],
      ['Medium', -1, 'unlock', 'recipe', 'r1'],
    ]);
    expect(await getBalances(user.id)).toEqual({ [a.id]: { Easy: 0, Medium: 1, Hard: 2 } });
  });

  it('skips buckets below min_difficulty', async () => {
    const { user, a } = await setup();
    await grant(user.id, a.id, 'Easy', 5);
    await grant(user.id, a.id, 'Hard', 2);
    await spend(user.id, [{ topicId: a.id, quantity: 2, minDifficulty: 'Medium' }], { reason: 'unlock', refType: 'recipe', refId: 'r' });
    expect(await getBalances(user.id)).toEqual({ [a.id]: { Easy: 5, Hard: 0 } });
  });

  it('throws InsufficientTokens and writes nothing on any shortfall', async () => {
    const { user, a, b } = await setup();
    await grant(user.id, a.id, 'Easy', 5);
    await grant(user.id, b.id, 'Easy', 1);
    const before = await prisma.tokenLedger.count();

    const err = await spend(
      user.id,
      [
        { topicId: a.id, quantity: 2, minDifficulty: 'Easy' }, // coverable
        { topicId: b.id, quantity: 2, minDifficulty: 'Easy' }, // short by 1
      ],
      { reason: 'unlock', refType: 'recipe', refId: 'r' }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(InsufficientTokens);
    expect((err as InsufficientTokens).shortfalls).toEqual([{ topicId: b.id, minDifficulty: 'Easy', need: 2, have: 1 }]);
    expect(await prisma.tokenLedger.count()).toBe(before);
  });

  it('concurrent spends never overdraw', async () => {
    const { user, a } = await setup();
    await grant(user.id, a.id, 'Easy', 7);
    await grant(user.id, a.id, 'Medium', 3);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        spend(user.id, [{ topicId: a.id, quantity: 1, minDifficulty: 'Easy' }], {
          reason: 'unlock',
          refType: 'recipe',
          refId: `r${i}`,
        })
      )
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(10);
    expect(failed).toHaveLength(10);
    expect(failed.every((r) => (r as PromiseRejectedResult).reason instanceof InsufficientTokens)).toBe(true);
    expect(await getBalances(user.id)).toEqual({ [a.id]: { Easy: 0, Medium: 0 } });

    // Every bucket stayed ≥ 0 at every point of the ledger's history.
    const rows = await prisma.tokenLedger.findMany({ where: { userId: user.id }, orderBy: { id: 'asc' } });
    const running = { Easy: 0, Medium: 0, Hard: 0 };
    for (const r of rows) {
      running[r.sourceDifficulty] += r.amount;
      expect(running[r.sourceDifficulty]).toBeGreaterThanOrEqual(0);
    }
  });

  it('concurrent multi-token spends never overdraw either', async () => {
    const { user, a } = await setup();
    await grant(user.id, a.id, 'Hard', 10);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        spend(user.id, [{ topicId: a.id, quantity: 3, minDifficulty: 'Medium' }], {
          reason: 'hint',
          refType: 'hint',
          refId: `h${i}`,
        })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(await balanceOf(user.id, a.id)).toBe(1);
  });

  it('ignores zero quantities and rejects negative ones', async () => {
    const { user, a } = await setup();
    expect(await spend(user.id, [{ topicId: a.id, quantity: 0, minDifficulty: 'Easy' }], { reason: 'hint', refType: 'hint', refId: 'h' })).toEqual([]);
    await expect(
      spend(user.id, [{ topicId: a.id, quantity: -1, minDifficulty: 'Easy' }], { reason: 'hint', refType: 'hint', refId: 'h' })
    ).rejects.toThrow(/non-negative/);
  });
});

describe('the ledger itself', () => {
  it('is append-only: UPDATE and DELETE raise', async () => {
    const { user, a } = await setup();
    await grant(user.id, a.id, 'Easy', 1);
    await expect(prisma.tokenLedger.updateMany({ data: { amount: 5 } })).rejects.toThrow(/append-only/);
    await expect(prisma.tokenLedger.deleteMany({})).rejects.toThrow(/append-only/);
    expect(await balanceOf(user.id, a.id)).toBe(1);
  });

  it('reports per-topic balances', async () => {
    const { user, a, b } = await setup();
    await grant(user.id, a.id, 'Easy', 2);
    await grant(user.id, a.id, 'Hard', 1);
    await grantTokens(user.id, { topicId: b.id, difficulty: 'Medium', amount: 4, refId: 'welcome' });
    await grantTokens(user.id, { topicId: b.id, difficulty: 'Medium', amount: 4, refId: 'welcome' }); // idempotent
    expect(await getTopicBalances(user.id)).toEqual([
      { topicId: a.id, slug: 'arrays', title: 'arrays', total: 3, byDifficulty: { Easy: 2, Medium: 0, Hard: 1 } },
      { topicId: b.id, slug: 'graphs', title: 'graphs', total: 4, byDifficulty: { Easy: 0, Medium: 4, Hard: 0 } },
    ]);
  });
});
