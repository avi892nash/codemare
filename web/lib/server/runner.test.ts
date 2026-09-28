import { describe, expect, it } from 'vitest';
import type { CompileClient, RunRequest, RunResponse, RunStreamEvent, RunTestResult } from '@/lib/compile';
import { CompileServiceError } from '@/lib/compile';
import { consume, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import { readSseEvents, type RunEvent, type TestEventData, type VerdictEventData } from '@/lib/sse';
import type { Difficulty, TestDef } from '@/lib/types';
import { AccessDenied, InvalidInput, MissingDependencies, NotFoundError } from './errors';
import { finishGate, startGate } from './gates';
import {
  handleRunRequest,
  prepareBuildRun,
  prepareQuestionRun,
  QuestionLocked,
  redactHiddenError,
  streamRun,
  type PreparedRun,
} from './runner';
import { prisma, setupTestDatabase } from './test/db';
import {
  balanceOf,
  makeBuildStep,
  makeComponent,
  makeGate,
  makeTier,
  makeTopic,
  makeUser,
  unlockTopicRow,
} from './test/factories';

setupTestDatabase();

// ─── fixtures ────────────────────────────────────────────────────────────

const SIG = { params: [{ name: 'nums', type: 'int[]' }, { name: 'target', type: 'int' }], returns: 'int[]' } as const;

const TESTS: TestDef[] = [
  { input: [[2, 7, 11, 15], 9], expected: [0, 1], hidden: false, explain_on_fail: 'pair at the front' },
  { input: [[3, 2, 4], 6], expected: [1, 2], hidden: false },
  { input: [[5, 5, 1], 10], expected: [0, 1], hidden: true, explain_on_fail: 'duplicates' },
  { input: [[1, 2, 3, 9], 12], expected: [2, 3], hidden: true },
];

let seq = 0;
async function makeRunQuestion(
  opts: {
    topicId: string;
    status?: 'draft' | 'published';
    authorId?: string;
    difficulty?: Difficulty;
    tests?: TestDef[];
    references?: Record<string, string>;
  }
) {
  const slug = `run-q-${++seq}`;
  return prisma.question.create({
    data: {
      slug,
      title: slug,
      difficulty: opts.difficulty ?? 'Easy',
      statementMd: '',
      examples: [],
      constraints: [],
      functionName: 'twoSum',
      signature: SIG,
      compareMode: 'unordered',
      starterCode: {},
      tests: (opts.tests ?? TESTS) as object[],
      referenceSolutions: opts.references ?? { python: 'def twoSum(nums, target): ...' },
      status: opts.status ?? 'published',
      authorId: opts.authorId,
      timeLimitMs: 1500,
      memoryLimitMb: 128,
      topics: { create: [{ topicId: opts.topicId, weight: 1 }] },
    },
  });
}

async function world() {
  const tier0 = await makeTier(0);
  const tier1 = await makeTier(1);
  const arrays = await makeTopic(tier0.id, { slug: `arrays-${++seq}` });
  const graphs = await makeTopic(tier1.id, { slug: `graphs-${++seq}` });
  const q = await makeRunQuestion({ topicId: arrays.id });
  const locked = await makeRunQuestion({ topicId: graphs.id });
  const user = await makeUser();
  return { tier0, tier1, arrays, graphs, q, locked, user };
}

type Script = (req: RunRequest) => RunStreamEvent[];

/** A compile service that replays scripted events and records what it was asked. */
function fakeCompile(script: Script, reference?: (req: RunRequest) => RunResponse) {
  const streamed: RunRequest[] = [];
  const ran: RunRequest[] = [];
  const client: CompileClient = {
    async run(req) {
      ran.push(req);
      if (!reference) throw new Error('unexpected reference run');
      return reference(req);
    },
    async *runStream(req, signal) {
      streamed.push(req);
      for (const e of script(req)) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        yield e;
      }
    },
  };
  return { client, streamed, ran };
}

function result(idx: number, passed: boolean, over: Partial<RunTestResult> = {}): RunTestResult {
  return { idx, hidden: false, passed, runUs: 10 + idx, wallUs: 20, memoryKb: 100 + idx, actual: [0, 1], ...over };
}

/** Everything passes, with the judge echoing `actual` for hidden tests too. */
const allPass: Script = (req) => [
  { event: 'running', data: {} },
  ...req.tests.map((t, i) => ({ event: 'test' as const, data: result(i, true, { hidden: !!t.hidden, actual: t.expected }) })),
  {
    event: 'verdict',
    data: { status: 'OK', totalPassed: req.tests.length, totalTests: req.tests.length, runUs: 100, memoryKb: 103 },
  },
];

async function collect(run: PreparedRun, client: CompileClient, signal?: AbortSignal) {
  const events: RunEvent[] = [];
  const verdict = await streamRun(run, (e) => events.push(e), { compile: client, signal });
  return { events, verdict, tests: events.filter((e) => e.event === 'test').map((e) => e.data as TestEventData) };
}

// ─── run / submit ────────────────────────────────────────────────────────

describe('run', () => {
  it('sends only visible tests, relays events in the web shape and persists a `run`', async () => {
    const { q, user } = await world();
    const { client, streamed } = fakeCompile(allPass);
    const prepared = await prepareQuestionRun(user.id, { kind: 'run', questionId: q.id, language: 'python', code: 'pass' });
    const { events, verdict, tests } = await collect(prepared, client);

    expect(streamed[0].tests).toEqual([
      { input: [[2, 7, 11, 15], 9], expected: [0, 1], hidden: false },
      { input: [[3, 2, 4], 6], expected: [1, 2], hidden: false },
    ]);
    expect(streamed[0]).toMatchObject({ functionName: 'twoSum', compareMode: 'unordered', limits: { timeMs: 1500, memoryMb: 128 } });
    expect(events.map((e) => e.event)).toEqual(['queued', 'running', 'test', 'test', 'verdict']);
    expect(events[0].data).toMatchObject({ totalTests: 2 });
    expect(tests[0]).toEqual({ idx: 0, passed: true, hidden: false, runtimeUs: 10, memoryKb: 100, input: [[2, 7, 11, 15], 9], expected: [0, 1], actual: [0, 1] });
    expect(verdict).toMatchObject({ status: 'OK', totalPassed: 2, totalTests: 2, runtimeUs: 21, memoryKb: 103 });
    expect(verdict?.tokensAwarded).toBeUndefined();

    const sub = await prisma.submission.findUniqueOrThrow({ where: { id: verdict!.submissionId! }, include: { testResults: true } });
    expect(sub).toMatchObject({ kind: 'run', status: 'OK', totalPassed: 2, userId: user.id, questionId: q.id });
    expect(sub.testResults).toHaveLength(2);
    expect(await balanceOf(user.id, (await prisma.questionTopic.findFirstOrThrow({ where: { questionId: q.id } })).topicId)).toBe(0);
  });

  it('judges custom inputs against the reference solution', async () => {
    const { q, user } = await world();
    const { client, ran, streamed } = fakeCompile(allPass, (req) => ({
      status: 'WA',
      totalPassed: 0,
      totalTests: req.tests.length,
      runUs: 1,
      memoryKb: 1,
      tests: req.tests.map((_, i) => result(i, false, { actual: [i, i + 1] })),
    }));
    const prepared = await prepareQuestionRun(
      user.id,
      { kind: 'run', questionId: q.id, language: 'go', code: 'x', customInputs: [[[1, 5, 9], 14]] },
      { compile: client }
    );
    expect(ran[0]).toMatchObject({ language: 'python', functionName: 'twoSum', tests: [{ input: [[1, 5, 9], 14], expected: null }] });
    const { tests } = await collect(prepared, client);
    expect(streamed[0].tests[2]).toEqual({ input: [[1, 5, 9], 14], expected: [0, 1], hidden: false });
    expect(tests[2]).toMatchObject({ idx: 2, custom: true, input: [[1, 5, 9], 14], expected: [0, 1] });
  });

  it('rejects custom inputs that do not fit the signature, or that the reference fails on', async () => {
    const { q, user } = await world();
    const bad = prepareQuestionRun(user.id, { kind: 'run', questionId: q.id, language: 'python', code: 'x', customInputs: [[[1, 2]]] });
    await expect(bad).rejects.toBeInstanceOf(InvalidInput);
    await expect(bad).rejects.toThrow(/Custom case 1: expected 2 arguments/);
    const typed = prepareQuestionRun(user.id, { kind: 'run', questionId: q.id, language: 'python', code: 'x', customInputs: [[['a'], 1]] });
    await expect(typed).rejects.toThrow(/nums\[0\]: expected an int/);

    const { client } = fakeCompile(allPass, (req) => ({
      status: 'RE',
      totalPassed: 0,
      totalTests: 1,
      runUs: 0,
      memoryKb: 0,
      tests: req.tests.map((_, i) => result(i, false, { error: 'IndexError: list index out of range' })),
    }));
    await expect(
      prepareQuestionRun(user.id, { kind: 'run', questionId: q.id, language: 'python', code: 'x', customInputs: [[[], 0]] }, { compile: client })
    ).rejects.toThrow(/isn’t a valid input for this problem/);

    const noRef = await makeRunQuestion({ topicId: (await prisma.questionTopic.findFirstOrThrow({ where: { questionId: q.id } })).topicId, references: {} });
    await expect(
      prepareQuestionRun(user.id, { kind: 'run', questionId: noRef.id, language: 'python', code: 'x', customInputs: [[[1], 1]] })
    ).rejects.toThrow(/no reference solution/);
  });
});

describe('submit', () => {
  it('runs every test but never lets hidden input / expected / actual out — in events or in the DB', async () => {
    const { q, user } = await world();
    const script: Script = (req) => [
      { event: 'compiling', data: {} },
      { event: 'running', data: {} },
      { event: 'test', data: result(0, true, { actual: [0, 1] }) },
      { event: 'test', data: result(1, false, { actual: [9, 9] }) },
      { event: 'test', data: result(2, false, { hidden: true, actual: [4, 4] }) },
      { event: 'test', data: result(3, true, { hidden: true, actual: [2, 3] }) },
      { event: 'verdict', data: { status: 'WA', totalPassed: 2, totalTests: req.tests.length, runUs: 50, memoryKb: 103, compileMs: 12 } },
    ];
    const { client, streamed } = fakeCompile(script);
    const prepared = await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'cpp', code: 'x' });
    expect(streamed).toHaveLength(0);
    const { events, verdict, tests } = await collect(prepared, client);

    expect(streamed[0].tests.map((t) => t.hidden)).toEqual([false, false, true, true]);
    expect(events.map((e) => e.event)).toEqual(['queued', 'compiling', 'running', 'test', 'test', 'test', 'test', 'verdict']);
    expect(tests[1]).toMatchObject({ passed: false, actual: [9, 9], expected: [1, 2] });
    expect(tests[1].explainOnFail).toBeUndefined(); // that test has none
    expect(tests[0].explainOnFail).toBeUndefined(); // passed
    expect(tests[2]).toEqual({ idx: 2, passed: false, hidden: true, runtimeUs: 12, memoryKb: 102, explainOnFail: 'duplicates' });
    expect(tests[3]).toEqual({ idx: 3, passed: true, hidden: true, runtimeUs: 13, memoryKb: 103 });
    expect(JSON.stringify(events)).not.toContain('[5,5,1]');
    expect(JSON.stringify(events)).not.toContain('[4,4]');
    expect(verdict).toMatchObject({ status: 'WA', totalPassed: 2, totalTests: 4, compileMs: 12 });

    const rows = await prisma.testResult.findMany({ where: { submissionId: verdict!.submissionId! }, orderBy: { idx: 'asc' } });
    expect(rows.map((r) => [r.hidden, r.input === null, r.expected === null, r.actual === null])).toEqual([
      [false, false, false, false],
      [false, false, false, false],
      [true, true, true, true],
      [true, true, true, true],
    ]);
    expect(rows[2].explainOnFail).toBe('duplicates');
  });

  it('never records OK unless every test passed', async () => {
    const { q, user } = await world();
    const { client } = fakeCompile((req) => [
      { event: 'test', data: result(0, true) },
      { event: 'test', data: result(1, false) },
      { event: 'test', data: result(2, true, { hidden: true }) },
      { event: 'test', data: result(3, true, { hidden: true }) },
      { event: 'verdict', data: { status: 'OK', totalPassed: 4, totalTests: req.tests.length, runUs: 1, memoryKb: 1 } },
    ]);
    const prepared = await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'x' });
    const { verdict } = await collect(prepared, client);
    expect(verdict?.status).toBe('WA');
  });

  it('pays tokens, percentile and badges once — later accepts earn nothing more', async () => {
    const { q, user, arrays } = await world();
    await prisma.badge.create({
      data: { slug: 'first-accept', name: 'First Accept', description: 'd', icon: 'check', rarity: 'common', criteria: { kind: 'first_accept' }, ord: 0 },
    });
    const { client } = fakeCompile(allPass);
    const first = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'a' }), client);
    expect(first.verdict).toMatchObject({
      status: 'OK',
      totalPassed: 4,
      percentile: 0,
      tokensAwarded: [{ topic: arrays.slug, amount: 1 }],
      badgesAwarded: [{ slug: 'first-accept', name: 'First Accept' }],
    });
    // Hidden `actual` echoed by the judge never reaches the client.
    expect(first.tests[2]).not.toHaveProperty('actual');

    const second = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'b' }), client);
    expect(second.verdict).toMatchObject({ status: 'OK', tokensAwarded: [], badgesAwarded: [] });
    expect(second.verdict?.percentile).toBe(0);
    expect(await balanceOf(user.id, arrays.id)).toBe(1);
    expect(await prisma.tokenLedger.count({ where: { userId: user.id } })).toBe(1);
  });

  it('computes "beats N%" against other users', async () => {
    const { q, user } = await world();
    const other = await makeUser();
    const slow = fakeCompile((req) => [
      ...req.tests.map((_, i) => ({ event: 'test' as const, data: result(i, true, { runUs: 1000 }) })),
      { event: 'verdict', data: { status: 'OK', totalPassed: 4, totalTests: 4, runUs: 4000, memoryKb: 1 } },
    ]);
    await collect(await prepareQuestionRun(other.id, { kind: 'submit', questionId: q.id, language: 'java', code: 'a' }), slow.client);
    const fast = fakeCompile(allPass);
    const { verdict } = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'java', code: 'b' }), fast.client);
    expect(verdict?.percentile).toBe(50);
  });

  it('passes a CE through with no test results', async () => {
    const { q, user } = await world();
    const { client } = fakeCompile(() => [
      { event: 'compiling', data: {} },
      { event: 'verdict', data: { status: 'CE', totalPassed: 0, totalTests: 4, runUs: 0, memoryKb: 0, compileMs: 300, error: "solution.cpp:4:14: error: expected ';'" } },
    ]);
    const { events, verdict } = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'cpp', code: 'x' }), client);
    expect(events.filter((e) => e.event === 'test')).toHaveLength(0);
    expect(verdict).toMatchObject({ status: 'CE', totalPassed: 0, totalTests: 4, runtimeUs: null, memoryKb: null, compileMs: 300, error: "solution.cpp:4:14: error: expected ';'" });
    const sub = await prisma.submission.findUniqueOrThrow({ where: { id: verdict!.submissionId! } });
    expect(sub).toMatchObject({ status: 'CE', compileMs: 300, error: "solution.cpp:4:14: error: expected ';'" });
  });

  it('reduces hidden-test errors to their kind, and a crash on a hidden test hides its output', async () => {
    const { q, user } = await world();
    const leak = 'ValueError: [5, 5, 1]';
    const { client } = fakeCompile((req) => [
      { event: 'test', data: result(0, true) },
      { event: 'test', data: result(1, true) },
      { event: 'test', data: result(2, false, { hidden: true, runUs: 0, memoryKb: 0, actual: null, error: `Runtime error: ${leak}` }) },
      { event: 'test', data: result(3, false, { hidden: true, runUs: 0, memoryKb: 0, actual: null, error: 'Not run: the program stopped at an earlier test' }) },
      { event: 'verdict', data: { status: 'RE', totalPassed: 2, totalTests: req.tests.length, runUs: 21, memoryKb: 101, error: `Traceback...\n${leak}` } },
    ]);
    const { events, tests, verdict } = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'x' }), client);
    expect(tests[2].error).toBe('ValueError (details are hidden for hidden tests)');
    expect(tests[2]).toMatchObject({ runtimeUs: null, memoryKb: null });
    expect(tests[3].error).toBe('Not run: the program stopped at an earlier test');
    expect(verdict?.error).toMatch(/Runtime Error on a hidden test \(test 3\)/);
    expect(JSON.stringify(events)).not.toContain('[5, 5, 1]');
    const sub = await prisma.submission.findUniqueOrThrow({ where: { id: verdict!.submissionId! } });
    expect(sub.error).not.toContain('[5, 5, 1]');
  });

  it('uses the whole-process peak memory when tests report none (C++)', async () => {
    const { q, user } = await world();
    const { client } = fakeCompile((req) => [
      ...req.tests.map((_, i) => ({ event: 'test' as const, data: result(i, true, { memoryKb: 0 }) })),
      { event: 'verdict', data: { status: 'OK', totalPassed: 4, totalTests: 4, runUs: 50, memoryKb: 2208 } },
    ]);
    const { tests, verdict } = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'cpp', code: 'x' }), client);
    expect(tests[0].memoryKb).toBeNull();
    expect(verdict?.memoryKb).toBe(2208);
    expect((await prisma.submission.findUniqueOrThrow({ where: { id: verdict!.submissionId! } })).memoryKb).toBe(2208);
  });
});

describe('judge failures and cancellation', () => {
  it('closes the submission as XX when the judge reports an error', async () => {
    const { q, user } = await world();
    const { client } = fakeCompile(() => [{ event: 'running', data: {} }, { event: 'error', data: { message: 'sandbox exploded' } }]);
    const { verdict } = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'x' }), client);
    expect(verdict).toMatchObject({ status: 'XX', error: 'sandbox exploded' });
  });

  it('closes the submission as XX when the stream breaks, or ends without a verdict', async () => {
    const { q, user } = await world();
    const broken: CompileClient = {
      run: async () => {
        throw new Error('unused');
      },
      // eslint-disable-next-line require-yield
      async *runStream() {
        throw new TypeError('fetch failed');
      },
    };
    const a = await collect(await prepareQuestionRun(user.id, { kind: 'run', questionId: q.id, language: 'python', code: 'x' }), broken);
    expect(a.verdict).toMatchObject({ status: 'XX', error: expect.stringMatching(/unreachable/) });

    const { client } = fakeCompile(() => [{ event: 'test', data: result(0, true) }]);
    const b = await collect(await prepareQuestionRun(user.id, { kind: 'run', questionId: q.id, language: 'python', code: 'x' }), client);
    expect(b.verdict).toMatchObject({ status: 'XX', error: 'The judge stopped before a verdict.' });
  });

  it('turns a judge 400 into a readable XX', async () => {
    const { q, user } = await world();
    const rejecting: CompileClient = {
      run: async () => {
        throw new Error('unused');
      },
      // eslint-disable-next-line require-yield
      async *runStream() {
        throw new CompileServiceError(400, JSON.stringify({ error: 'tests[0].expected: expected int[]', details: [] }));
      },
    };
    const { verdict } = await collect(await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'go', code: 'x' }), rejecting);
    expect(verdict).toMatchObject({ status: 'XX', error: 'The judge rejected this run: tests[0].expected: expected int[]' });
  });

  it('aborts the judge when the browser goes away and closes the submission as cancelled', async () => {
    const { q, user } = await world();
    const controller = new AbortController();
    let sawAbort = false;
    const client: CompileClient = {
      run: async () => {
        throw new Error('unused');
      },
      async *runStream(_req, signal) {
        yield { event: 'running', data: {} };
        yield { event: 'test', data: result(0, true) };
        controller.abort();
        sawAbort = signal?.aborted === true;
        throw new DOMException('aborted', 'AbortError');
      },
    };
    const events: RunEvent[] = [];
    const verdict = await streamRun(
      await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'x' }),
      (e) => events.push(e),
      { compile: client, signal: controller.signal }
    );
    expect(sawAbort).toBe(true);
    expect(verdict).toBeNull();
    expect(events.map((e) => e.event)).toEqual(['queued', 'running', 'test']);
    const sub = await prisma.submission.findFirstOrThrow({ where: { userId: user.id } });
    expect(sub).toMatchObject({ status: 'XX', error: 'Cancelled before the verdict.' });
  });
});

// ─── access ──────────────────────────────────────────────────────────────

describe('access', () => {
  it('403s a locked question with what is blocking it', async () => {
    const { locked, user, graphs } = await world();
    const err = await prepareQuestionRun(user.id, { kind: 'run', questionId: locked.id, language: 'python', code: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(QuestionLocked);
    expect(err.status).toBe(403);
    const body = err.toJSON();
    expect(body).toMatchObject({ error: 'access_denied', reason: 'topic_locked', mapUrl: '/map', lockedTopics: [{ slug: graphs.slug }] });
    expect(body.blockers[0]).toMatchObject({ topic: { slug: graphs.slug }, blocker: { kind: 'gate' } });

    await unlockTopicRow(user.id, graphs.id);
    await expect(prepareQuestionRun(user.id, { kind: 'run', questionId: locked.id, language: 'python', code: 'x' })).resolves.toBeTruthy();
  });

  it('hides drafts from everyone but their author and staff; unknown ids are 404', async () => {
    const { arrays, user } = await world();
    const author = await makeUser({ role: 'author' });
    const draft = await makeRunQuestion({ topicId: arrays.id, status: 'draft', authorId: author.id });
    await expect(prepareQuestionRun(user.id, { kind: 'run', questionId: draft.id, language: 'python', code: 'x' })).rejects.toMatchObject({
      reason: 'draft',
      status: 403,
    });
    await expect(prepareQuestionRun(author.id, { kind: 'run', questionId: draft.id, language: 'python', code: 'x' })).resolves.toBeTruthy();
    await expect(prepareQuestionRun(user.id, { kind: 'run', questionId: 'nope', language: 'python', code: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('gate submissions', () => {
  async function gateWorld() {
    const w = await world();
    const gate = await makeGate(w.tier1.id, { questionIds: [w.q.id, w.locked.id], passThreshold: 1 });
    const attempt = await startGate(w.user.id, gate.id);
    return { ...w, gate, attempt };
  }

  it('an attemptId makes a `gate` submission that earns no tokens', async () => {
    const { q, user, attempt, arrays } = await gateWorld();
    const { client } = fakeCompile(allPass);
    const prepared = await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'x', attemptId: attempt.id });
    expect(prepared).toMatchObject({ kind: 'gate', gateAttemptId: attempt.id });
    const { verdict } = await collect(prepared, client);
    expect(verdict).toMatchObject({ status: 'OK', tokensAwarded: [] });
    expect(verdict?.percentile).toBeUndefined();
    expect(await balanceOf(user.id, arrays.id)).toBe(0);
  });

  it('a question reachable only through the attempt submits for the gate even without attemptId', async () => {
    const { locked, user, attempt } = await gateWorld();
    const prepared = await prepareQuestionRun(user.id, { kind: 'submit', questionId: locked.id, language: 'python', code: 'x' });
    expect(prepared).toMatchObject({ kind: 'gate', gateAttemptId: attempt.id });
    const run = await prepareQuestionRun(user.id, { kind: 'run', questionId: locked.id, language: 'python', code: 'x' });
    expect(run.kind).toBe('run');
  });

  it('refuses a finished attempt and questions outside the gate', async () => {
    const { q, user, attempt, arrays } = await gateWorld();
    const outside = await makeRunQuestion({ topicId: arrays.id });
    await expect(
      prepareQuestionRun(user.id, { kind: 'submit', questionId: outside.id, language: 'python', code: 'x', attemptId: attempt.id })
    ).rejects.toMatchObject({ reason: 'forbidden' });
    await finishGate(user.id, attempt.id);
    const err = await prepareQuestionRun(user.id, { kind: 'submit', questionId: q.id, language: 'python', code: 'x', attemptId: attempt.id }).catch((e) => e);
    expect(err).toBeInstanceOf(AccessDenied);
    expect(err.reason).toBe('gate_attempt_closed');
  });
});

// ─── builds ──────────────────────────────────────────────────────────────

describe('builds', () => {
  async function buildWorld() {
    const w = await world();
    const base = await makeComponent({ topicId: w.arrays.id, slug: `base-${++seq}`, languages: ['python', 'go'] });
    const top = await makeComponent({ topicId: w.arrays.id, slug: `top-${++seq}`, languages: ['python', 'go'], dependsOn: [base.id] });
    const baseStep = await makeBuildStep(base.id, { difficulty: 'Medium' });
    const topStep = await makeBuildStep(top.id);
    const predict = await makeBuildStep(top.id, { kind: 'predict', ord: 1 });
    return { ...w, base, top, baseStep, topStep, predict };
  }

  it('409s with the missing dependencies, then builds with the passing version as prelude', async () => {
    const { user, base, baseStep, topStep, arrays } = await buildWorld();
    const err = await prepareBuildRun(user.id, { buildStepId: topStep.id, language: 'python', code: 'def f(): return 0' }).catch((e) => e);
    expect(err).toBeInstanceOf(MissingDependencies);
    expect(err.status).toBe(409);
    expect(err.toJSON()).toMatchObject({ missing: [base.slug] });

    const { client, streamed } = fakeCompile(allPass);
    const built = await collect(await prepareBuildRun(user.id, { buildStepId: baseStep.id, language: 'python', code: 'BASE' }), client);
    expect(built.verdict).toMatchObject({ status: 'OK', tokensAwarded: [{ topic: arrays.slug, amount: 2 }] });
    expect(built.verdict?.componentVersionId).toBeTruthy();
    expect(streamed[0].prelude).toBeUndefined();
    const version = await prisma.componentVersion.findFirstOrThrow({ where: { userId: user.id, componentId: base.id } });
    expect(version).toMatchObject({ passed: true, code: 'BASE', language: 'python' });
    expect(await prisma.stepProgress.findFirst({ where: { userId: user.id, buildStepId: baseStep.id } })).toMatchObject({ status: 'passed' });

    const again = await collect(await prepareBuildRun(user.id, { buildStepId: baseStep.id, language: 'python', code: 'BASE2' }), client);
    expect(again.verdict?.tokensAwarded).toEqual([]);

    const top = await prepareBuildRun(user.id, { buildStepId: topStep.id, language: 'python', code: 'TOP' });
    expect(top.request.prelude).toEqual(['BASE2']);
    expect(top.request).toMatchObject({ functionName: 'f', tests: [{ input: [], expected: 0, hidden: false }] });
    // Other languages need their own passing version.
    await expect(prepareBuildRun(user.id, { buildStepId: topStep.id, language: 'go', code: 'x' })).rejects.toBeInstanceOf(MissingDependencies);
  });

  it('refuses predict steps, languages the component does not offer, and locked topics', async () => {
    const { user, predict, baseStep, graphs } = await buildWorld();
    await expect(prepareBuildRun(user.id, { buildStepId: predict.id, language: 'python', code: 'x' })).rejects.toThrow(/predict step/);
    await expect(prepareBuildRun(user.id, { buildStepId: baseStep.id, language: 'cpp', code: 'x' })).rejects.toThrow(/can’t be built in cpp/);
    await expect(prepareBuildRun(user.id, { buildStepId: baseStep.id, language: 'java', code: 'x' })).rejects.toBeInstanceOf(InvalidInput);
    const lockedComponent = await makeComponent({ topicId: graphs.id });
    const lockedStep = await makeBuildStep(lockedComponent.id);
    await expect(prepareBuildRun(user.id, { buildStepId: lockedStep.id, language: 'python', code: 'x' })).rejects.toMatchObject({ status: 403 });
  });

  it('a failing build records a failed version and earns nothing', async () => {
    const { user, base, baseStep, arrays } = await buildWorld();
    const { client } = fakeCompile((req) => [
      { event: 'test', data: result(0, false, { actual: 1 }) },
      { event: 'verdict', data: { status: 'WA', totalPassed: 0, totalTests: req.tests.length, runUs: 1, memoryKb: 1 } },
    ]);
    const { verdict } = await collect(await prepareBuildRun(user.id, { buildStepId: baseStep.id, language: 'python', code: 'x' }), client);
    expect(verdict?.status).toBe('WA');
    expect(verdict?.tokensAwarded).toBeUndefined();
    expect(await prisma.componentVersion.findFirstOrThrow({ where: { componentId: base.id } })).toMatchObject({ passed: false });
    expect(await balanceOf(user.id, arrays.id)).toBe(0);
  });
});

// ─── redaction ───────────────────────────────────────────────────────────

describe('redactHiddenError', () => {
  it.each([
    ['Time limit exceeded', 'Time limit exceeded'],
    ['Memory limit exceeded', 'Memory limit exceeded'],
    ['Not run: the program stopped at an earlier test', 'Not run: the program stopped at an earlier test'],
    ['Runtime error: IndexError: list index out of range', 'IndexError (details are hidden for hidden tests)'],
    ['Exception in thread "main" java.lang.ArrayIndexOutOfBoundsException: Index 7', 'ArrayIndexOutOfBoundsException (details are hidden for hidden tests)'],
    ['Exception: [1, 2, 3]', 'Exception (details are hidden for hidden tests)'],
    ['panic: runtime error: index out of range [5] with length 3', 'panic (details are hidden for hidden tests)'],
    ["terminate called after throwing an instance of 'std::out_of_range'", 'Runtime error (details are hidden for hidden tests)'],
  ])('%s', (input, expected) => {
    expect(redactHiddenError(input)).toBe(expected);
  });
});

// ─── HTTP ────────────────────────────────────────────────────────────────

describe('handleRunRequest', () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('http://test.local/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('401 without a user, 400 for bad bodies, 413 for big sources', async () => {
    const { q, user } = await world();
    expect((await handleRunRequest(post({}), 'run', null)).status).toBe(401);
    const bad = await handleRunRequest(post({ questionId: q.id, language: 'cobol', code: 'x' }), 'run', user.id);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'invalid_input', message: expect.stringMatching(/^language/) });
    expect((await handleRunRequest(post('{nope'), 'run', user.id)).status).toBe(400);
    // customInputs are not part of a submit.
    expect((await handleRunRequest(post({ questionId: q.id, language: 'python', code: 'x', customInputs: [] }), 'submit', user.id)).status).toBe(400);
    expect((await handleRunRequest(post({ questionId: q.id, language: 'python', code: '   ' }), 'run', user.id)).status).toBe(400);
    const big = await handleRunRequest(post({ questionId: q.id, language: 'python', code: 'x'.repeat(64 * 1024 + 1) }), 'run', user.id);
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: 'source_too_large' });
    const huge = await handleRunRequest(post({ questionId: q.id, language: 'python', code: 'x'.repeat(600 * 1024) }), 'run', user.id);
    expect(huge.status).toBe(413);
  });

  it('403 / 404 / 409 as JSON before any stream', async () => {
    const { locked, user } = await world();
    const res = await handleRunRequest(post({ questionId: locked.id, language: 'python', code: 'x' }), 'submit', user.id);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toMatch(/json/);
    expect(await res.json()).toMatchObject({ reason: 'topic_locked', mapUrl: '/map' });
    expect((await handleRunRequest(post({ questionId: 'missing', language: 'python', code: 'x' }), 'submit', user.id)).status).toBe(404);

    const tier0 = await prisma.tier.findFirstOrThrow({ where: { ord: 0 } });
    const topic = await makeTopic(tier0.id);
    const dep = await makeComponent({ topicId: topic.id });
    const comp = await makeComponent({ topicId: topic.id, dependsOn: [dep.id] });
    const step = await makeBuildStep(comp.id);
    const build = await handleRunRequest(post({ buildStepId: step.id, language: 'python', code: 'x' }), 'build', user.id);
    expect(build.status).toBe(409);
    expect(await build.json()).toMatchObject({ error: 'missing_dependencies', missing: [dep.slug] });
  });

  it('429 once the shared per-user budget is spent', async () => {
    const { q, user } = await world();
    for (let i = 0; i < SUBMISSION_PER_USER.limit; i++) consume(`submit:${user.id}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
    const res = await handleRunRequest(post({ questionId: q.id, language: 'python', code: 'x' }), 'run', user.id);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('streams text/event-stream with heartbeats, ending in the verdict', async () => {
    const { q, user } = await world();
    const slow: CompileClient = {
      run: async () => {
        throw new Error('unused');
      },
      async *runStream(req) {
        yield { event: 'running', data: {} };
        await new Promise((r) => setTimeout(r, 60));
        for (const e of allPass(req).slice(1)) yield e;
      },
    };
    const res = await handleRunRequest(post({ questionId: q.id, language: 'python', code: 'x' }), 'run', user.id, { compile: slow, heartbeatMs: 15 });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toContain('no-transform');
    const raw = await res.text();
    expect(raw).toContain(': keep-alive');
    const events: Array<{ event: string; data: unknown }> = [];
    for await (const e of readSseEvents(new Response(raw).body!)) events.push(e);
    expect(events.map((e) => e.event)).toEqual(['queued', 'running', 'test', 'test', 'verdict']);
    expect((events.at(-1)!.data as VerdictEventData).status).toBe('OK');
  });

  it('cancelling the response stream aborts the judge', async () => {
    const { q, user } = await world();
    let ended: (aborted: boolean) => void = () => undefined;
    const judgeEnded = new Promise<boolean>((r) => (ended = r));
    const hanging: CompileClient = {
      run: async () => {
        throw new Error('unused');
      },
      async *runStream(_req, signal) {
        try {
          yield { event: 'running', data: {} };
          await new Promise<void>((_, reject) => {
            const stop = () => reject(new DOMException('aborted', 'AbortError'));
            // Like fetch: an already-aborted signal rejects at once.
            if (signal?.aborted) stop();
            else signal?.addEventListener('abort', stop);
          });
        } finally {
          ended(signal?.aborted === true);
        }
      },
    };
    const res = await handleRunRequest(post({ questionId: q.id, language: 'python', code: 'x' }), 'run', user.id, { compile: hanging });
    const reader = res.body!.getReader();
    await reader.read(); // queued
    await reader.cancel();
    expect(await judgeEnded).toBe(true);
    await expect
      .poll(async () => (await prisma.submission.findFirst({ where: { userId: user.id } }))?.error, { timeout: 5000 })
      .toBe('Cancelled before the verdict.');
  });
});
