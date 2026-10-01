import { describe, expect, it } from 'vitest';
import { computePercentile, onAcceptedSubmit } from './awards';
import { InvalidInput } from './errors';
import { completeSubmission, createSubmission, getSubmissionDetail, markSubmissionRunning } from './submissions';
import { prisma, setupTestDatabase } from './test/db';
import { balanceOf, makeSubmission, makeUser, makeWorld } from './test/factories';

setupTestDatabase();

const tests = [
  { idx: 0, passed: true, hidden: false, runtimeUs: 120, memoryKb: 900, input: [[1, 2], 3], expected: [0, 1], actual: [0, 1], explainOnFail: 'x' },
  { idx: 1, passed: true, hidden: true, runtimeUs: 80, memoryKb: 1200, input: [[5], 5], expected: [0], actual: [0] },
];

describe('submission lifecycle', () => {
  it('validates the kind ↔ reference pairing', async () => {
    const user = await makeUser();
    await expect(createSubmission({ userId: user.id, kind: 'submit', language: 'python', code: '', questionId: '' })).rejects.toBeInstanceOf(
      InvalidInput
    );
    await expect(
      createSubmission({ userId: user.id, kind: 'gate', language: 'python', code: '', questionId: 'q' })
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it('queued → running → verdict, with totals and sanitized test results', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const { id } = await createSubmission({ userId: user.id, kind: 'submit', language: 'python', code: 'pass', questionId: w.q1.id });
    expect((await prisma.submission.findUniqueOrThrow({ where: { id } })).status).toBe('queued');
    await markSubmissionRunning(id);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id } })).status).toBe('running');

    const done = await completeSubmission(id, {
      status: 'OK',
      compileMs: 12.6,
      tests: [...tests, { idx: 2, passed: false, hidden: true, runtimeUs: 50, memoryKb: 700, input: [[9], 9], expected: [0], actual: [1], explainOnFail: 'edge case' }],
    });

    // One failed test → OK is not recorded.
    expect(done).toMatchObject({ status: 'WA', totalPassed: 2, totalTests: 3, runtimeUs: 250, memoryKb: 1200, compileMs: 13 });
    expect(done.tests[0]).toEqual({ idx: 0, passed: true, hidden: false, runtimeUs: 120, memoryKb: 900, input: [[1, 2], 3], expected: [0, 1], actual: [0, 1] });
    expect(done.tests[2]).toEqual({ idx: 2, passed: false, hidden: true, runtimeUs: 50, memoryKb: 700, explainOnFail: 'edge case' });

    const rows = await prisma.testResult.findMany({ where: { submissionId: id }, orderBy: { idx: 'asc' } });
    expect(rows.map((r) => [r.idx, r.hidden, r.input, r.expected, r.actual, r.explainOnFail])).toEqual([
      [0, false, [[1, 2], 3], [0, 1], [0, 1], null],
      [1, true, null, null, null, null],
      [2, true, null, null, null, 'edge case'],
    ]);
    const hidden = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM app.test_results WHERE submission_id = ${id} AND hidden AND input IS NULL AND expected IS NULL AND actual IS NULL`;
    expect(Number(hidden[0].n)).toBe(2);

    const sub = await prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(sub.runtimeUs).toBe(250n);
    await expect(completeSubmission(id, { status: 'OK', tests })).rejects.toBeInstanceOf(InvalidInput);
  });

  it('shows a submission only to its owner, without hidden test data', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const other = await makeUser();
    const { id } = await createSubmission({ userId: user.id, kind: 'submit', language: 'python', code: 'pass', questionId: w.q1.id });
    await completeSubmission(id, { status: 'OK', tests });
    const detail = await getSubmissionDetail(user.id, id);
    expect(detail).toMatchObject({ status: 'OK', runtimeUs: 200, question: { slug: 'q-arrays' } });
    expect(detail?.tests[1]).toEqual({ idx: 1, passed: true, hidden: true, runtimeUs: 80, memoryKb: 1200 });
    expect(await getSubmissionDetail(other.id, id)).toBeNull();
  });
});

describe('onAcceptedSubmit', () => {
  it('pays first-solve tokens once, sets the percentile, reports badges', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await prisma.badge.create({
      data: { slug: 'first-blood', name: 'First Blood', description: '', icon: 'zap', rarity: 'common', criteria: { kind: 'first_accept' }, ord: 0 },
    });
    const first = await makeSubmission(user.id, { questionId: w.q1.id, runtimeUs: 500 });
    const r1 = await onAcceptedSubmit(user.id, first.id);
    expect(r1.tokensAwarded).toEqual([{ topic: 'arrays', title: 'arrays', amount: 1 }]);
    expect(r1.percentile).toBe(0); // alone: nobody is slower
    expect(r1.badgesAwarded.map((b) => b.slug)).toEqual(['first-blood']);

    const again = await makeSubmission(user.id, { questionId: w.q1.id, runtimeUs: 400 });
    const r2 = await onAcceptedSubmit(user.id, again.id);
    expect(r2.tokensAwarded).toEqual([]);
    expect(r2.badgesAwarded).toEqual([]);
    expect(await balanceOf(user.id, w.arrays.id)).toBe(1);
  });

  it('earns nothing for gate submissions but still evaluates badges', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const attempt = await prisma.gateAttempt.create({
      data: { userId: user.id, gateId: w.gate.id, deadlineAt: new Date(Date.now() + 3_600_000) },
    });
    const s = await makeSubmission(user.id, { kind: 'gate', questionId: w.q1.id, gateAttemptId: attempt.id });
    expect(await onAcceptedSubmit(user.id, s.id)).toEqual({ tokensAwarded: [], percentile: null, badgesAwarded: [] });
    expect(await prisma.tokenLedger.count()).toBe(0);
  });

  it('rejects submissions that were not accepted', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const s = await makeSubmission(user.id, { questionId: w.q1.id, status: 'WA' });
    await expect(onAcceptedSubmit(user.id, s.id)).rejects.toBeInstanceOf(InvalidInput);
  });
});

describe('percentile', () => {
  it("compares with the latest accepted submit per user, same question and language", async () => {
    const w = await makeWorld();
    const [a, b, c, d] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const q = w.q1.id;
    const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
    await makeSubmission(a.id, { questionId: q, runtimeUs: 100, createdAt: t(1) });
    await makeSubmission(a.id, { questionId: q, runtimeUs: 900, createdAt: t(2) }); // a's latest: 900
    await makeSubmission(b.id, { questionId: q, runtimeUs: 700, createdAt: t(3) });
    await makeSubmission(c.id, { questionId: q, runtimeUs: 50, createdAt: t(4), language: 'cpp' }); // other language
    await makeSubmission(c.id, { questionId: q, runtimeUs: 10, createdAt: t(5), status: 'WA' }); // not accepted
    const mine = await makeSubmission(d.id, { questionId: q, runtimeUs: 300, createdAt: t(6) });

    // Population {a: 900, b: 700, d: 300} → 2 of 3 slower.
    expect(await computePercentile(mine.id)).toBe(66.67);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: mine.id } })).percentile).toBe(66.67);
  });
});
