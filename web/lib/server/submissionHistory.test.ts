import { describe, expect, it } from 'vitest';
import { EMPTY_SUBMISSION_QUERY, type SubmissionQuery } from '@/components/Submissions/query';
import { getSubmissionView, listUserSubmissions } from './submissionHistory';
import { completeSubmission, createSubmission } from './submissions';
import { prisma, setupTestDatabase } from './test/db';
import { makeBuildStep, makeComponent, makeSubmission, makeUser, makeWorld } from './test/factories';

setupTestDatabase();

const Q = (patch: Partial<SubmissionQuery> = {}): SubmissionQuery => ({ ...EMPTY_SUBMISSION_QUERY, ...patch });
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function history() {
  const w = await makeWorld();
  const user = await makeUser();
  const other = await makeUser();
  const component = await makeComponent({ topicId: w.arrays.id, slug: 'lower-bound' });
  const step = await makeBuildStep(component.id);
  const ok = await makeSubmission(user.id, { questionId: w.q1.id, status: 'OK', language: 'python', createdAt: minutesAgo(40) });
  const wa = await makeSubmission(user.id, { questionId: w.q2.id, kind: 'run', status: 'WA', language: 'javascript', createdAt: minutesAgo(30) });
  const queued = await makeSubmission(user.id, { questionId: w.q1.id, status: 'queued', language: 'go', createdAt: minutesAgo(20) });
  const build = await makeSubmission(user.id, { buildStepId: step.id, kind: 'build', status: 'OK', language: 'typescript', createdAt: minutesAgo(10) });
  const theirs = await makeSubmission(other.id, { questionId: w.q1.id, status: 'OK' });
  return { w, user, other, component, step, ok, wa, queued, build, theirs };
}

describe('listUserSubmissions', () => {
  it("lists only the user's submissions, newest first, with what each was for", async () => {
    const h = await history();
    const r = await listUserSubmissions(h.user.id, Q());
    expect(r.rows.map((x) => x.id)).toEqual([h.build.id, h.queued.id, h.wa.id, h.ok.id]);
    expect(r).toMatchObject({ total: 4, page: 1, pageCount: 1, hasAny: true });
    expect(r.rows[0].subject).toEqual({ type: 'build', componentSlug: 'lower-bound', componentTitle: 'lower-bound', stepTitle: 'step' });
    expect(r.rows[3].subject).toEqual({ type: 'question', slug: 'q-arrays', title: 'q-arrays', difficulty: 'Easy' });
    expect(r.rows[3]).toMatchObject({ kind: 'submit', status: 'OK', language: 'python', runtimeUs: 1000 });
  });

  it('filters by verdict, pending, language and kind', async () => {
    const h = await history();
    const ids = async (q: Partial<SubmissionQuery>) => (await listUserSubmissions(h.user.id, Q(q))).rows.map((x) => x.id);
    expect(await ids({ status: 'OK' })).toEqual([h.build.id, h.ok.id]);
    expect(await ids({ status: 'pending' })).toEqual([h.queued.id]);
    expect(await ids({ language: 'javascript' })).toEqual([h.wa.id]);
    expect(await ids({ kind: 'build' })).toEqual([h.build.id]);
    expect(await ids({ status: 'OK', kind: 'submit' })).toEqual([h.ok.id]);
    const none = await listUserSubmissions(h.user.id, Q({ status: 'TLE' }));
    expect(none).toMatchObject({ rows: [], total: 0, hasAny: true });
  });

  it('paginates and clamps the page', async () => {
    const h = await history();
    const p2 = await listUserSubmissions(h.user.id, Q({ page: 2 }), { pageSize: 3 });
    expect(p2.rows.map((x) => x.id)).toEqual([h.ok.id]);
    expect(p2.pageCount).toBe(2);
    expect((await listUserSubmissions(h.user.id, Q({ page: 50 }), { pageSize: 3 })).page).toBe(2);
  });

  it('knows when a user has no submissions at all', async () => {
    await history();
    const fresh = await makeUser();
    expect(await listUserSubmissions(fresh.id, Q())).toMatchObject({ rows: [], total: 0, hasAny: false });
  });
});

describe('getSubmissionView', () => {
  async function judged() {
    const w = await makeWorld();
    const user = await makeUser({ handle: 'ada' });
    const { id } = await createSubmission({ userId: user.id, kind: 'submit', language: 'python', code: 'def solve(n):\n    return n\n', questionId: w.q1.id });
    await completeSubmission(id, {
      status: 'WA',
      compileMs: 12,
      tests: [
        { idx: 0, passed: true, hidden: false, runtimeUs: 120, memoryKb: 900, input: [1], expected: 1, actual: 1, explainOnFail: 'basic' },
        { idx: 1, passed: false, hidden: false, runtimeUs: 80, memoryKb: 950, input: [2], expected: 4, actual: 2, explainOnFail: 'squares' },
        { idx: 2, passed: false, hidden: true, runtimeUs: 70, memoryKb: 990, input: [9], expected: 81, actual: 9, error: 'boom', explainOnFail: 'secret edge case' },
        { idx: 3, passed: true, hidden: true, runtimeUs: 60, memoryKb: 800, input: [3], expected: 9, actual: 9 },
      ],
    });
    return { w, user, id };
  }

  it('shows the owner everything but the hidden tests’ details', async () => {
    const { user, id } = await judged();
    const v = await getSubmissionView(user.id, id);
    expect(v).toMatchObject({
      id,
      own: true,
      status: 'WA',
      totalPassed: 2,
      totalTests: 4,
      runtimeUs: 330,
      memoryKb: 990,
      compileMs: 12,
      owner: { handle: 'ada' },
      subject: { type: 'question', slug: 'q-arrays' },
    });
    expect(v!.tests[0]).toEqual({
      idx: 0, passed: true, hidden: false, runtimeUs: 120, memoryKb: 900,
      args: [{ name: 'n', value: 1 }], expected: 1, actual: 1,
    });
    expect(v!.tests[1]).toMatchObject({ passed: false, args: [{ name: 'n', value: 2 }], expected: 4, actual: 2, explainOnFail: 'squares' });
    // Hidden: pass/fail only — no data, error, explanation or timing.
    expect(v!.tests[2]).toEqual({ idx: 2, passed: false, hidden: true });
    expect(v!.tests[3]).toEqual({ idx: 3, passed: true, hidden: true });
  });

  it('is invisible to other learners, visible to staff and admins', async () => {
    const { id } = await judged();
    const learner = await makeUser();
    const author = await makeUser({ role: 'author' });
    const staff = await makeUser({ role: 'staff' });
    const admin = await makeUser({ role: 'admin' });
    expect(await getSubmissionView(learner.id, id)).toBeNull();
    expect(await getSubmissionView(author.id, id)).toBeNull();
    expect(await getSubmissionView(staff.id, id)).toMatchObject({ id, own: false, owner: { handle: 'ada' } });
    expect(await getSubmissionView(admin.id, id)).toMatchObject({ id, own: false });
  });

  it('returns null for unknown or absurd ids', async () => {
    const { user } = await judged();
    expect(await getSubmissionView(user.id, 'nope')).toBeNull();
    expect(await getSubmissionView(user.id, 'x'.repeat(500))).toBeNull();
  });

  it('describes build submissions by component and step', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    const component = await makeComponent({ topicId: w.arrays.id, slug: 'prefix-sums' });
    const step = await makeBuildStep(component.id);
    const s = await makeSubmission(user.id, { buildStepId: step.id, kind: 'build', status: 'OK', language: 'python' });
    await prisma.testResult.create({ data: { submissionId: s.id, idx: 0, passed: true, hidden: false, input: [], expected: 0, actual: 0 } });
    const v = await getSubmissionView(user.id, s.id);
    expect(v?.subject).toEqual({ type: 'build', componentSlug: 'prefix-sums', componentTitle: 'prefix-sums', stepTitle: 'step' });
    // The component signature has no params: an empty argument list.
    expect(v?.tests[0].args).toEqual([]);
  });
});
