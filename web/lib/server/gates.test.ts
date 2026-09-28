import { describe, expect, it } from 'vitest';
import { AccessDenied, GateNotEligible } from './errors';
import {
  assertGateSubmissionAllowed,
  finishGate,
  getGateAttempt,
  getGateStatus,
  startGate,
} from './gates';
import { isTierOpen } from './unlocks';
import { prisma, setupTestDatabase } from './test/db';
import { makeGate, makeQuestion, makeSubmission, makeTier, makeTopic, makeUser, makeWorld } from './test/factories';

setupTestDatabase();

const t0 = new Date('2026-05-01T09:00:00.000Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

async function gateSetup() {
  const w = await makeWorld(); // tier-1 gate: q1 + q2, threshold 2, cooldown 12 h, 60 min
  const user = await makeUser();
  return { ...w, user };
}

describe('eligibility and start', () => {
  it('starts an attempt with deadline = start + time limit', async () => {
    const { user, gate } = await gateSetup();
    expect((await getGateStatus(user.id, gate.id, t0)).state).toBe('eligible');
    const attempt = await startGate(user.id, gate.id, t0);
    expect(attempt).toMatchObject({ gateId: gate.id, startedAt: t0, deadlineAt: at(60), finishedAt: null, passed: null });
    const status = await getGateStatus(user.id, gate.id, at(1));
    expect(status).toMatchObject({ state: 'running', eligible: false, runningAttempt: { id: attempt.id } });
  });

  it('allows one running attempt at a time', async () => {
    const { user, gate } = await gateSetup();
    await startGate(user.id, gate.id, t0);
    const err = await startGate(user.id, gate.id, at(5)).catch((e) => e);
    expect(err).toBeInstanceOf(GateNotEligible);
    expect((err as GateNotEligible).reason).toBe('running');
  });

  it('needs tier N−1 open', async () => {
    const { user, q1 } = await gateSetup();
    const tier2 = await makeTier(2);
    await makeTopic(tier2.id);
    const gate2 = await makeGate(tier2.id, { questionIds: [q1.id] });
    expect((await getGateStatus(user.id, gate2.id, t0)).state).toBe('previous_tier_closed');
    await expect(startGate(user.id, gate2.id, t0)).rejects.toMatchObject({ reason: 'previous_tier_closed' });
  });
});

describe('finishing', () => {
  it('passes at the threshold and opens the tier', async () => {
    const { user, gate, tier1, q1, q2 } = await gateSetup();
    const attempt = await startGate(user.id, gate.id, t0);
    await makeSubmission(user.id, { kind: 'gate', questionId: q1.id, gateAttemptId: attempt.id, createdAt: at(10) });
    await makeSubmission(user.id, { kind: 'gate', questionId: q1.id, gateAttemptId: attempt.id, createdAt: at(11) }); // same question
    await makeSubmission(user.id, { kind: 'gate', questionId: q2.id, gateAttemptId: attempt.id, createdAt: at(12), status: 'WA' });
    await makeSubmission(user.id, { kind: 'gate', questionId: q2.id, gateAttemptId: attempt.id, createdAt: at(20) });

    const r = await finishGate(user.id, attempt.id, at(30));
    expect(r).toMatchObject({ passed: true, passedCount: 2, passThreshold: 2, tierUnlocked: true, nextEligibleAt: null });
    expect(r.attempt.finishedAt).toEqual(at(30));
    expect(await isTierOpen(user.id, tier1.id)).toBe(true);
    expect((await getGateStatus(user.id, gate.id, at(31))).state).toBe('passed');
    await expect(startGate(user.id, gate.id, at(32))).rejects.toMatchObject({ reason: 'already_open' });
  });

  it('fails below the threshold and cools down for cooldown_hours', async () => {
    const { user, gate, tier1, q1 } = await gateSetup();
    const attempt = await startGate(user.id, gate.id, t0);
    await makeSubmission(user.id, { kind: 'gate', questionId: q1.id, gateAttemptId: attempt.id, createdAt: at(5) });
    // An accepted normal submit of q2 does not count for the gate.
    await makeSubmission(user.id, { kind: 'submit', questionId: q1.id, createdAt: at(6) });

    const r = await finishGate(user.id, attempt.id, at(20));
    expect(r).toMatchObject({ passed: false, passedCount: 1, tierUnlocked: false });
    expect(r.nextEligibleAt).toEqual(at(20 + 12 * 60));
    expect(await isTierOpen(user.id, tier1.id)).toBe(false);

    const cooling = await getGateStatus(user.id, gate.id, at(21));
    expect(cooling).toMatchObject({ state: 'cooldown', eligible: false, nextEligibleAt: at(20 + 12 * 60) });
    const err = await startGate(user.id, gate.id, at(20 + 12 * 60 - 1)).catch((e) => e);
    expect(err).toMatchObject({ reason: 'cooldown', nextEligibleAt: at(20 + 12 * 60) });

    const retry = await startGate(user.id, gate.id, at(20 + 12 * 60));
    expect(retry.startedAt).toEqual(at(20 + 12 * 60));
  });

  it('is idempotent', async () => {
    const { user, gate } = await gateSetup();
    const attempt = await startGate(user.id, gate.id, t0);
    const first = await finishGate(user.id, attempt.id, at(10));
    const second = await finishGate(user.id, attempt.id, at(50));
    expect(second.attempt).toEqual(first.attempt);
    expect(await prisma.gateAttempt.count()).toBe(1);
  });

  it("refuses to finish someone else's attempt", async () => {
    const { user, gate } = await gateSetup();
    const other = await makeUser();
    const attempt = await startGate(user.id, gate.id, t0);
    await expect(finishGate(other.id, attempt.id, at(1))).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('lazy finish after the deadline', () => {
  it('finishes on read, stamped at the deadline, ignoring late submissions', async () => {
    const { user, gate, q1, q2 } = await gateSetup();
    const attempt = await startGate(user.id, gate.id, t0);
    await makeSubmission(user.id, { kind: 'gate', questionId: q1.id, gateAttemptId: attempt.id, createdAt: at(30) });
    await makeSubmission(user.id, { kind: 'gate', questionId: q2.id, gateAttemptId: attempt.id, createdAt: at(61) }); // late

    // Nobody called finishGate: reading the status after the deadline finishes it.
    const status = await getGateStatus(user.id, gate.id, at(90));
    expect(status.state).toBe('cooldown');
    expect(status.runningAttempt).toBeNull();
    expect(status.lastAttempt).toMatchObject({ id: attempt.id, finishedAt: at(60), passedCount: 1, passed: false });
    expect(status.nextEligibleAt).toEqual(at(60 + 12 * 60));

    const row = await prisma.gateAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.finishedAt).toEqual(at(60));
  });

  it('an explicit finish after the deadline is also stamped at the deadline', async () => {
    const { user, gate } = await gateSetup();
    const attempt = await startGate(user.id, gate.id, t0);
    const r = await finishGate(user.id, attempt.id, at(500));
    expect(r.attempt.finishedAt).toEqual(at(60));
    expect(r.nextEligibleAt).toEqual(at(60 + 12 * 60));
  });

  it('getGateAttempt lazily finishes too and reports per-question progress', async () => {
    const { user, gate, q1 } = await gateSetup();
    const attempt = await startGate(user.id, gate.id, t0);
    await makeSubmission(user.id, { kind: 'gate', questionId: q1.id, gateAttemptId: attempt.id, createdAt: at(3) });

    const live = await getGateAttempt(user.id, attempt.id, at(4));
    expect(live.running).toBe(true);
    expect(live.questions.map((q) => [q.slug, q.solved])).toEqual([
      ['q-arrays', true],
      ['q-strings', false],
    ]);

    const done = await getGateAttempt(user.id, attempt.id, at(61));
    expect(done.running).toBe(false);
    expect(done.attempt).toMatchObject({ finishedAt: at(60), passed: false, passedCount: 1 });
  });
});

describe('gate submissions', () => {
  it('are allowed only for questions of a running attempt of the user', async () => {
    const { user, gate, q1 } = await gateSetup();
    const outsider = await makeQuestion();
    const attempt = await startGate(user.id, gate.id, t0);
    await expect(assertGateSubmissionAllowed(user.id, attempt.id, q1.id, at(5))).resolves.toMatchObject({ id: attempt.id });
    await expect(assertGateSubmissionAllowed(user.id, attempt.id, outsider.id, at(5))).rejects.toBeInstanceOf(AccessDenied);
    await expect(assertGateSubmissionAllowed(user.id, attempt.id, q1.id, at(60))).rejects.toMatchObject({
      reason: 'gate_attempt_closed',
    });
  });
});
