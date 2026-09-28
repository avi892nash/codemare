import { describe, expect, it } from 'vitest';
import { AccessDenied, HintLocked, InsufficientTokens } from './errors';
import { getHintLadder, revealHint } from './hints';
import { earnForBuild, earnForSolve } from './ledger';
import { prisma, setupTestDatabase } from './test/db';
import {
  balanceOf,
  grant,
  makeBuildStep,
  makeComponent,
  makeHints,
  makeQuestion,
  makeUser,
  makeWorld,
} from './test/factories';

setupTestDatabase();

async function questionWithLadder() {
  const w = await makeWorld();
  const user = await makeUser();
  const q = await makeQuestion({
    difficulty: 'Hard',
    topics: [
      { topicId: w.arrays.id, weight: 1 },
      { topicId: w.strings.id, weight: 0.5 },
    ],
  });
  const hints = await makeHints({ questionId: q.id }, [
    { level: 'nudge', costKind: 'score', costAmount: 0 },
    { level: 'concept', costKind: 'score', costAmount: 10 },
    { level: 'pseudo', costKind: 'score', costAmount: 25 },
    { level: 'line', costKind: 'token', costAmount: 2 },
    { level: 'solution', costKind: 'score', costAmount: 100 },
  ]);
  return { w, user, q, hints };
}

describe('hint ladder', () => {
  it('shows every cost up front, bodies only once revealed', async () => {
    const { w, user, q, hints } = await questionWithLadder();
    const ladder = await getHintLadder(user.id, { questionId: q.id });
    expect(ladder.penalty).toBe(0);
    expect(ladder.rungs.map((r) => [r.level, r.costKind, r.costAmount, r.revealed, r.revealable, r.bodyMd])).toEqual([
      ['nudge', 'score', 0, false, true, null],
      ['concept', 'score', 10, false, false, null],
      ['pseudo', 'score', 25, false, false, null],
      ['line', 'token', 2, false, false, null],
      ['solution', 'score', 100, false, false, null],
    ]);
    // Token costs are charged to the highest-weight topic.
    expect(ladder.rungs[3].tokenTopic?.id).toBe(w.arrays.id);
    expect(ladder.rungs[3].affordable).toBe(false);
    expect(ladder.rungs[0].hintId).toBe(hints.nudge.id);
  });

  it('enforces ladder order (HintLocked lists what to reveal first) and writes nothing', async () => {
    const { user, hints } = await questionWithLadder();
    const err = await revealHint(user.id, hints.pseudo.id).catch((e) => e);
    expect(err).toBeInstanceOf(HintLocked);
    expect((err as HintLocked).missingLevels).toEqual(['nudge', 'concept']);
    expect(await prisma.hintUse.count()).toBe(0);
  });

  it('reveals in order, records hint_uses and accumulates the score penalty', async () => {
    const { user, q, hints } = await questionWithLadder();
    const nudge = await revealHint(user.id, hints.nudge.id);
    expect(nudge).toMatchObject({ alreadyRevealed: false, cost: { kind: 'score', amount: 0 }, penalty: 0 });
    expect(nudge.hint.bodyMd).toBe('nudge body');
    await revealHint(user.id, hints.concept.id);
    const pseudo = await revealHint(user.id, hints.pseudo.id);
    expect(pseudo.penalty).toBe(35);

    const uses = await prisma.hintUse.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    expect(uses.map((u) => [u.costKind, u.costAmount, u.questionId])).toEqual([
      ['score', 0, q.id],
      ['score', 10, q.id],
      ['score', 25, q.id],
    ]);
    const ladder = await getHintLadder(user.id, { questionId: q.id });
    expect(ladder.rungs.map((r) => r.revealable)).toEqual([false, false, false, true, false]);
    expect(ladder.rungs[2].bodyMd).toBe('pseudo body');
  });

  it('applies the score penalty to the future solve award', async () => {
    const { w, user, q, hints } = await questionWithLadder();
    await revealHint(user.id, hints.nudge.id);
    await revealHint(user.id, hints.concept.id);
    await revealHint(user.id, hints.pseudo.id); // 35%
    const awards = await earnForSolve(user.id, q.id);
    const by = Object.fromEntries(awards.map((a) => [a.topicId, a.amount]));
    expect(by[w.arrays.id]).toBe(2); // round(3 × 1 × 0.65) = round(1.95)
    expect(by[w.strings.id]).toBe(1); // round(3 × 0.5 × 0.65) = round(0.975)
  });

  it('spends tokens of the highest-weight topic for a token-cost hint', async () => {
    const { w, user, q, hints } = await questionWithLadder();
    for (const l of ['nudge', 'concept', 'pseudo'] as const) await revealHint(user.id, hints[l].id);
    await grant(user.id, w.arrays.id, 'Easy', 1);
    await grant(user.id, w.arrays.id, 'Hard', 5);

    const r = await revealHint(user.id, hints.line.id);
    expect(r.debits).toEqual([
      { topicId: w.arrays.id, difficulty: 'Easy', amount: 1 },
      { topicId: w.arrays.id, difficulty: 'Hard', amount: 1 },
    ]);
    const spent = await prisma.tokenLedger.findMany({ where: { amount: { lt: 0 } } });
    expect(spent.every((s) => s.reason === 'hint' && s.refType === 'hint' && s.refId === hints.line.id)).toBe(true);
    expect(r.penalty).toBe(35); // token costs add no score penalty
    expect(await balanceOf(user.id, w.arrays.id)).toBe(4);
    expect((await getHintLadder(user.id, { questionId: q.id })).rungs[3].revealed).toBe(true);
  });

  it('writes no hint_uses when the token cost cannot be paid', async () => {
    const { w, user, hints } = await questionWithLadder();
    for (const l of ['nudge', 'concept', 'pseudo'] as const) await revealHint(user.id, hints[l].id);
    await grant(user.id, w.arrays.id, 'Easy', 1);
    await expect(revealHint(user.id, hints.line.id)).rejects.toBeInstanceOf(InsufficientTokens);
    expect(await prisma.hintUse.count({ where: { hintId: hints.line.id } })).toBe(0);
    expect(await balanceOf(user.id, w.arrays.id)).toBe(1);
  });

  it('re-viewing is free', async () => {
    const { w, user, hints } = await questionWithLadder();
    for (const l of ['nudge', 'concept', 'pseudo'] as const) await revealHint(user.id, hints[l].id);
    await grant(user.id, w.arrays.id, 'Easy', 4);
    await revealHint(user.id, hints.line.id);
    const again = await revealHint(user.id, hints.line.id);
    expect(again).toMatchObject({ alreadyRevealed: true, debits: [] });
    expect(again.hint.bodyMd).toBe('line body');
    expect(await balanceOf(user.id, w.arrays.id)).toBe(2);
    expect(await prisma.hintUse.count({ where: { hintId: hints.line.id } })).toBe(1);
  });

  it('refuses hints of a locked question', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const q = await makeQuestion({ topics: [{ topicId: w.graphs.id }] });
    const hints = await makeHints({ questionId: q.id }, [{ level: 'nudge' }]);
    await expect(revealHint(user.id, hints.nudge.id)).rejects.toBeInstanceOf(AccessDenied);
  });
});

describe('build step hints', () => {
  it("charge the component's topic and penalize the build award", async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const component = await makeComponent({ topicId: w.strings.id });
    const step = await makeBuildStep(component.id, { difficulty: 'Hard' });
    const hints = await makeHints({ buildStepId: step.id }, [
      { level: 'nudge', costKind: 'token', costAmount: 1 },
      { level: 'concept', costKind: 'score', costAmount: 40 },
    ]);
    await grant(user.id, w.strings.id, 'Medium', 1);

    await revealHint(user.id, hints.nudge.id);
    expect(await balanceOf(user.id, w.strings.id)).toBe(0);
    const concept = await revealHint(user.id, hints.concept.id);
    expect(concept.penalty).toBe(40);

    const [award] = await earnForBuild(user.id, step.id);
    expect(award.amount).toBe(2); // round(3 × 0.6) = round(1.8)
  });
});
