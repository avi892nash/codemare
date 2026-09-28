import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/compile', () => {
  class CompileServiceError extends Error {
    constructor(
      public status: number,
      body: string
    ) {
      super(`compile service ${status}: ${body}`);
    }
  }
  return { compile: { run: vi.fn() }, CompileServiceError };
});

import { compile, CompileServiceError, type RunRequest, type RunResponse } from '@/lib/compile';
import { emptyDraft, generateStubs, type QuestionDraft } from '@/components/Author/model';
import { canAccessQuestion } from './access';
import {
  canAuthor,
  canEditQuestion,
  deleteDraft,
  getAuthorViewer,
  listAuthoredQuestions,
  loadQuestionDraft,
  parseDraft,
  publishQuestion,
  runReference,
  saveDraft,
  unpublishQuestion,
  type AuthorViewer,
} from './author';
import { prisma, setupTestDatabase } from './test/db';
import { makeSubmission, makeTier, makeTopic, makeUser } from './test/factories';

setupTestDatabase();

const run = vi.mocked(compile.run);

/** The judge answers every test with the Python semantics of `sum(x > 0)`. */
function judgeCountPositives() {
  run.mockImplementation(async (req: RunRequest): Promise<RunResponse> => {
    const tests = req.tests.map((t, idx) => {
      const actual = (t.input[0] as number[]).filter((x) => x > 0).length;
      return { idx, hidden: !!t.hidden, passed: actual === t.expected, runUs: 3, wallUs: 5, memoryKb: 100, actual };
    });
    const totalPassed = tests.filter((t) => t.passed).length;
    return {
      status: totalPassed === tests.length ? 'OK' : 'WA',
      totalPassed,
      totalTests: tests.length,
      runUs: 12,
      memoryKb: 100,
      tests,
    };
  });
}

function draft(over: Partial<QuestionDraft> = {}): QuestionDraft {
  const d = emptyDraft();
  const complete: QuestionDraft = {
    ...d,
    title: 'Count positives',
    slug: 'count-positives',
    topics: [{ slug: 'arrays', weight: 1 }],
    tags: ['Hash Table', 'array'],
    companies: ['  Acme  Corp '],
    statementMd: 'Return how many numbers in `nums` are > 0.',
    constraints: ['1 <= n', ''],
    examples: [{ input: 'nums = [1,-2]', output: '1', explanation: '' }],
    functionName: 'countPositives',
    params: [{ name: 'nums', type: 'int[]' }],
    returns: 'int',
    starterCode: generateStubs('countPositives', { params: [{ name: 'nums', type: 'int[]' }], returns: 'int' }),
    tests: [
      { args: '[[1,-2]]', expected: '1', hidden: false, explainOnFail: '' },
      { args: '[[]]', expected: '0', hidden: true, explainOnFail: 'empty input' },
      { args: '[[-1]]', expected: '0', hidden: true, explainOnFail: '' },
      { args: '[[5,6]]', expected: '2', hidden: true, explainOnFail: '' },
    ],
    referenceSolutions: { ...d.referenceSolutions, python: 'def countPositives(nums):\n    return sum(x > 0 for x in nums)\n' },
    hints: d.hints.map((h) => ({ ...h, bodyMd: `${h.level} body` })),
  };
  return { ...complete, ...over };
}

async function world() {
  const tier0 = await makeTier(0);
  await makeTopic(tier0.id, { slug: 'arrays' });
  const author = await makeUser({ role: 'author' });
  const other = await makeUser({ role: 'author' });
  const staff = await makeUser({ role: 'staff' });
  const learner = await makeUser({ role: 'learner' });
  const v = async (u: { id: string }) => (await getAuthorViewer(u.id))!;
  return { author: await v(author), other: await v(other), staff: await v(staff), learner: await v(learner) };
}

beforeEach(() => {
  run.mockReset();
});

describe('roles', () => {
  it('lets author and above author, and staff edit anyone’s questions', () => {
    expect(canAuthor('learner')).toBe(false);
    expect(canAuthor('author')).toBe(true);
    expect(canAuthor('admin')).toBe(true);
    const q = { authorId: 'u1' };
    expect(canEditQuestion({ id: 'u1', role: 'author' }, q)).toBe(true);
    expect(canEditQuestion({ id: 'u2', role: 'author' }, q)).toBe(false);
    expect(canEditQuestion({ id: 'u2', role: 'staff' }, q)).toBe(true);
    expect(canEditQuestion({ id: 'u1', role: 'learner' }, q)).toBe(false);
    expect(canEditQuestion({ id: 'u2', role: 'staff' }, { authorId: null })).toBe(true);
  });

  it('reads the role from the database, not the session', async () => {
    const u = await makeUser({ role: 'author' });
    expect((await getAuthorViewer(u.id))?.role).toBe('author');
    await prisma.user.update({ where: { id: u.id }, data: { role: 'learner' } });
    expect((await getAuthorViewer(u.id))?.role).toBe('learner');
    expect(await getAuthorViewer(null)).toBeNull();
  });
});

describe('parseDraft', () => {
  it('normalizes tags, companies, constraints and examples', () => {
    const { draft: d, errors } = parseDraft(draft());
    expect(errors).toEqual([]);
    expect(d!.tags).toEqual(['hash-table', 'array']);
    expect(d!.companies).toEqual(['Acme Corp']);
    expect(d!.constraints).toEqual(['1 <= n']);
  });

  it('rejects what no stored question may hold', () => {
    const { errors } = parseDraft(
      draft({
        slug: 'Bad Slug',
        functionName: '1x',
        params: [
          { name: 'a', type: 'int' },
          { name: 'a', type: 'int' },
        ],
        tests: [{ args: '{}', expected: '1', hidden: false, explainOnFail: '' }],
      })
    );
    expect(errors.map((e) => e.path)).toEqual(['slug', 'functionName', 'params.1.name', 'tests.0.args']);
    expect(parseDraft({ nope: true }).draft).toBeNull();
    expect(parseDraft(draft({ timeLimitMs: 60_000 })).errors[0].path).toBe('timeLimitMs');
  });
});

describe('saving drafts', () => {
  it('creates a draft owned by its author and round-trips it', async () => {
    const w = await world();
    const res = await saveDraft(w.author, draft());
    expect(res).toMatchObject({ ok: true, slug: 'count-positives', status: 'draft' });
    if (!res.ok) return;
    const row = await prisma.question.findUniqueOrThrow({ where: { id: res.id }, include: { hints: true, topics: true } });
    expect(row).toMatchObject({ authorId: w.author.id, status: 'draft', functionName: 'countPositives' });
    expect(row.hints).toHaveLength(5);
    expect(row.topics).toHaveLength(1);
    expect(row.tests).toEqual([
      { input: [[1, -2]], expected: 1, hidden: false },
      { input: [[]], expected: 0, hidden: true, explain_on_fail: 'empty input' },
      { input: [[-1]], expected: 0, hidden: true },
      { input: [[5, 6]], expected: 2, hidden: true },
    ]);
    expect(Object.keys(row.referenceSolutions as object)).toEqual(['python']);

    const loaded = await loadQuestionDraft(w.author, res.id);
    expect(loaded?.meta.status).toBe('draft');
    expect(loaded?.draft).toMatchObject({
      id: res.id,
      params: [{ name: 'nums', type: 'int[]' }],
      tests: expect.arrayContaining([{ args: '[[]]', expected: '0', hidden: true, explainOnFail: 'empty input' }]),
      referenceSolutions: expect.objectContaining({ python: expect.stringContaining('sum'), cpp: '' }),
    });
  });

  it('accepts incomplete drafts (only a title and slug are required)', async () => {
    const w = await world();
    const d = { ...emptyDraft(), title: 'WIP', slug: 'wip' };
    d.tests = [];
    const res = await saveDraft(w.author, d);
    expect(res.ok).toBe(true);
    const row = await prisma.question.findUniqueOrThrow({ where: { slug: 'wip' }, include: { hints: true } });
    expect(row.hints).toHaveLength(0);
    expect(row.functionName).toBe('');
  });

  it('refuses learners, unknown topics and taken slugs', async () => {
    const w = await world();
    expect(await saveDraft(w.learner, draft())).toMatchObject({ ok: false, code: 'not_found' });
    expect(await saveDraft(w.author, draft({ topics: [{ slug: 'nope', weight: 1 }] }))).toMatchObject({
      ok: false,
      code: 'invalid',
      fieldErrors: [{ path: 'topics.0', message: 'Unknown topic "nope"' }],
    });
    expect((await saveDraft(w.author, draft())).ok).toBe(true);
    expect(await saveDraft(w.other, draft())).toMatchObject({ ok: false, fieldErrors: [{ path: 'slug' }] });
  });

  it('enforces ownership: other authors cannot edit, staff can', async () => {
    const w = await world();
    const res = await saveDraft(w.author, draft());
    if (!res.ok) throw new Error('save failed');
    const edit = draft({ id: res.id, title: 'Renamed' });
    expect(await saveDraft(w.other, edit)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await loadQuestionDraft(w.other, res.id)).toBeNull();
    expect(await saveDraft(w.staff, edit)).toMatchObject({ ok: true, id: res.id });
    const row = await prisma.question.findUniqueOrThrow({ where: { id: res.id } });
    expect(row).toMatchObject({ title: 'Renamed', authorId: w.author.id });
  });

  it('keeps a removed hint level that learners already revealed', async () => {
    const w = await world();
    const res = await saveDraft(w.author, draft());
    if (!res.ok) throw new Error('save failed');
    const nudge = await prisma.hint.findFirstOrThrow({ where: { questionId: res.id, level: 'nudge' } });
    await prisma.hintUse.create({
      data: { userId: w.learner.id, hintId: nudge.id, questionId: res.id, costKind: 'score', costAmount: 0 },
    });
    const d = draft({ id: res.id });
    d.hints = d.hints.map((h) => (h.level === 'nudge' || h.level === 'line' ? { ...h, bodyMd: '' } : h));
    expect((await saveDraft(w.author, d)).ok).toBe(true);
    const levels = (await prisma.hint.findMany({ where: { questionId: res.id } })).map((h) => h.level).sort();
    expect(levels).toEqual(['concept', 'nudge', 'pseudo', 'solution']);
  });
});

describe('publishing', () => {
  it('refuses an incomplete checklist without calling the judge', async () => {
    const w = await world();
    const d = draft();
    d.tests = d.tests.slice(0, 2);
    const res = await publishQuestion(w.author, d);
    expect(res).toMatchObject({ ok: false, code: 'checklist' });
    expect(run).not.toHaveBeenCalled();
    expect(await prisma.question.count()).toBe(0);
  });

  it('re-runs every reference on the judge and publishes only when all pass', async () => {
    judgeCountPositives();
    const w = await world();
    const d = draft();
    d.referenceSolutions.javascript = 'function countPositives(nums) { return nums.filter((x) => x > 0).length; }';
    const res = await publishQuestion(w.author, d);
    expect(res).toMatchObject({ ok: true, status: 'published' });
    expect(run).toHaveBeenCalledTimes(2);
    const req = run.mock.calls[0][0];
    expect(req).toMatchObject({
      language: 'python',
      functionName: 'countPositives',
      signature: { params: [{ name: 'nums', type: 'int[]' }], returns: 'int' },
      compareMode: 'ordered',
      limits: { timeMs: 2000, memoryMb: 256 },
    });
    expect(req.tests[1]).toEqual({ input: [[]], expected: 0, hidden: true });
    expect(res.runs?.map((r) => [r.language, r.status])).toEqual([
      ['python', 'OK'],
      ['javascript', 'OK'],
    ]);
  });

  it('publishes nothing when a reference fails', async () => {
    judgeCountPositives();
    const w = await world();
    const d = draft();
    d.tests[3] = { ...d.tests[3], expected: '3' };
    const saved = await saveDraft(w.author, d);
    if (!saved.ok) throw new Error('save failed');
    const res = await publishQuestion(w.author, { ...d, id: saved.id, title: 'Changed' });
    expect(res).toMatchObject({ ok: false, code: 'verification', error: 'Python reference fails 1 of 4 tests' });
    const row = await prisma.question.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row).toMatchObject({ status: 'draft', title: 'Count positives' });
  });

  it('locks the slug once published and routes edits through publish', async () => {
    judgeCountPositives();
    const w = await world();
    const pub = await publishQuestion(w.author, draft());
    if (!pub.ok) throw new Error('publish failed');
    expect(await saveDraft(w.author, draft({ id: pub.id }))).toMatchObject({ ok: false, code: 'conflict' });
    expect(await publishQuestion(w.author, draft({ id: pub.id, slug: 'new-slug' }))).toMatchObject({
      ok: false,
      fieldErrors: [{ path: 'slug' }],
    });
    expect(await publishQuestion(w.author, draft({ id: pub.id, title: 'Count the positives' }))).toMatchObject({ ok: true });
    expect((await prisma.question.findUniqueOrThrow({ where: { id: pub.id } })).title).toBe('Count the positives');
  });

  it('keeps drafts private to their author and staff; published questions follow topic access', async () => {
    judgeCountPositives();
    const w = await world();
    const saved = await saveDraft(w.author, draft());
    if (!saved.ok) throw new Error('save failed');
    expect(await canAccessQuestion(w.author.id, saved.id)).toMatchObject({ ok: true, via: 'author' });
    expect(await canAccessQuestion(w.staff.id, saved.id)).toMatchObject({ ok: true });
    expect(await canAccessQuestion(w.learner.id, saved.id)).toEqual({ ok: false, reason: 'draft' });
    expect((await publishQuestion(w.author, draft({ id: saved.id }))).ok).toBe(true);
    expect(await canAccessQuestion(w.learner.id, saved.id)).toEqual({ ok: true, via: 'topics' });
  });

  it('unpublishes and deletes only safe drafts', async () => {
    judgeCountPositives();
    const w = await world();
    const pub = await publishQuestion(w.author, draft());
    if (!pub.ok) throw new Error('publish failed');
    expect(await deleteDraft(w.author, pub.id)).toMatchObject({ ok: false });
    expect(await unpublishQuestion(w.other, pub.id)).toMatchObject({ ok: false, code: 'not_found' });
    expect(await unpublishQuestion(w.author, pub.id)).toMatchObject({ ok: true, status: 'draft' });
    await makeSubmission(w.learner.id, { questionId: pub.id });
    expect(await deleteDraft(w.author, pub.id)).toMatchObject({ ok: false });
    await prisma.submission.deleteMany({});
    expect(await deleteDraft(w.author, pub.id)).toEqual({ ok: true });
    expect(await prisma.question.count()).toBe(0);
  });
});

describe('listing', () => {
  it('shows authors their own questions and staff everything', async () => {
    const w = await world();
    await saveDraft(w.author, draft());
    await saveDraft(w.other, draft({ slug: 'other-one', title: 'Other' }));
    const mine = await listAuthoredQuestions(w.author);
    expect(mine.map((q) => [q.slug, q.tests, q.hiddenTests, q.mine])).toEqual([['count-positives', 4, 3, true]]);
    expect((await listAuthoredQuestions(w.author, 'all')).length).toBe(1);
    expect((await listAuthoredQuestions(w.staff, 'all')).map((q) => q.slug).sort()).toEqual(['count-positives', 'other-one']);
  });
});

describe('reference runs', () => {
  const viewer = (role: AuthorViewer['role'] = 'author'): AuthorViewer => ({ id: `u-${role}`, role, handle: role });

  it('runs tests that still lack an expected output against a typed placeholder', async () => {
    judgeCountPositives();
    const d = draft();
    d.tests[1] = { ...d.tests[1], expected: '' };
    const res = await runReference(viewer(), { draft: d, language: 'python' });
    if (!res.ok) throw new Error(res.error);
    expect(run.mock.calls[0][0].tests[1]).toEqual({ input: [[]], expected: 0, hidden: true });
    expect(res.run.tests[1]).toMatchObject({ idx: 1, expectedMissing: true, passed: false, hasActual: true, actual: 0 });
    expect(res.run.status).toBe('WA');
    expect(res.run.totalPassed).toBe(3);
  });

  it('checks test values against the signature before a typed-language run', async () => {
    const d = draft();
    d.referenceSolutions.go = 'func countPositives(nums []int) int { return 0 }';
    d.tests[0] = { ...d.tests[0], args: '[["x"]]' };
    expect(await runReference(viewer(), { draft: d, language: 'go' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Test 1 argument 1 \(nums\)/),
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('never reports OK unless every test passed, and maps judge outages to XX', async () => {
    run.mockResolvedValueOnce({
      status: 'OK',
      totalPassed: 1,
      totalTests: 4,
      runUs: 1,
      memoryKb: 1,
      tests: [{ idx: 0, hidden: false, passed: true, runUs: 1, wallUs: 1, memoryKb: 1, actual: 1 }],
    });
    const first = await runReference(viewer(), { draft: draft(), language: 'python' });
    expect(first.ok && first.run.status).toBe('WA');

    run.mockRejectedValueOnce(new CompileServiceError(503, 'busy'));
    const second = await runReference(viewer(), { draft: draft(), language: 'python' });
    expect(second).toMatchObject({ ok: true, run: { status: 'XX', error: expect.stringMatching(/unavailable \(503\)/) } });

    expect(await runReference(viewer('learner'), { draft: draft(), language: 'python' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await runReference(viewer(), { draft: draft(), language: 'cpp' })).toMatchObject({ ok: false, code: 'invalid' });
  });
});
