// Run with: npx tsx --test tests/run/runStream.test.ts
//
// POST /v1/run/stream end to end (local sandbox adapter). The heartbeat is
// shortened via RUN_STREAM_HEARTBEAT_MS so the test can observe one.
import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseSse, postJson, postSse, startTestServer, TestServer } from './httpHarness.js';

let server: TestServer;
let STREAM: string;

before(async () => {
  server = await startTestServer({ RUN_STREAM_HEARTBEAT_MS: '100' });
  STREAM = `${server.url}/v1/run/stream`;
});
after(async () => {
  await server.close();
});

const sig = {
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
  returns: 'int[]',
};
const tests = [
  { input: [[2, 7, 11, 15], 9], expected: [0, 1] },
  { input: [[3, 2, 4], 6], expected: [1, 2] },
  { input: [[3, 3], 6], expected: [0, 1], hidden: true },
];

const names = (events: Array<{ event: string }>) => events.filter((e) => e.event !== ':').map((e) => e.event);

test('OK run: running → one test event per test, in order → verdict', async () => {
  const res = await postSse(STREAM, {
    language: 'python',
    code: 'def twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen:\n            return [seen[target - n], i]\n        seen[n] = i\n',
    functionName: 'twoSum',
    signature: sig,
    tests,
  });
  assert.equal(res.status, 200);
  assert.match(res.contentType ?? '', /^text\/event-stream/);
  assert.deepEqual(names(res.events), ['running', 'test', 'test', 'test', 'verdict']);
  const testEvents = res.events.filter((e) => e.event === 'test').map((e) => e.data as any);
  assert.deepEqual(testEvents.map((t) => t.idx), [0, 1, 2]);
  assert.deepEqual(testEvents.map((t) => t.hidden), [false, false, true]);
  for (const t of testEvents) {
    assert.equal(t.passed, true);
    for (const key of ['runUs', 'wallUs', 'memoryKb']) assert.equal(typeof t[key], 'number', key);
    assert.ok('actual' in t);
  }
  const verdict = res.events.at(-1)!.data as any;
  assert.equal(verdict.status, 'OK');
  assert.equal(verdict.totalPassed, 3);
  assert.equal(verdict.totalTests, 3);
  assert.equal(typeof verdict.runUs, 'number');
  assert.equal(typeof verdict.memoryKb, 'number');
  assert.equal(verdict.tests, undefined, 'the verdict event carries no tests array');
});

test('CE run: compiling → verdict(CE), no test events', async () => {
  const res = await postSse(STREAM, {
    language: 'cpp',
    code: 'std::vector<int> twoSum(std::vector<int>& nums, int target) {\n    return nums.size() + ;\n}\n',
    functionName: 'twoSum',
    signature: sig,
    tests,
  });
  assert.deepEqual(names(res.events), ['compiling', 'verdict']);
  const verdict = res.events.at(-1)!.data as any;
  assert.equal(verdict.status, 'CE');
  assert.equal(verdict.totalTests, 3);
  assert.match(verdict.error, /solution\.cpp:2/);
  assert.equal(typeof verdict.compileMs, 'number');
});

test('compiled languages: compiling only when a compile really happens (cache hit skips it)', async () => {
  const body = {
    language: 'cpp',
    // A unique comment makes the first run a guaranteed compile-cache miss.
    code: `// ${Date.now()}-${Math.random()}\nstd::vector<int> twoSum(std::vector<int>& nums, int target) {\n    for (int i = 0; i < (int)nums.size(); i++)\n        for (int j = i + 1; j < (int)nums.size(); j++)\n            if (nums[i] + nums[j] == target) return {i, j};\n    return {};\n}\n`,
    functionName: 'twoSum',
    signature: sig,
    tests,
  };
  const first = await postSse(STREAM, body);
  assert.deepEqual(names(first.events), ['compiling', 'running', 'test', 'test', 'test', 'verdict']);
  const second = await postSse(STREAM, body);
  assert.deepEqual(names(second.events), ['running', 'test', 'test', 'test', 'verdict']);
  assert.equal((second.events.at(-1)!.data as any).status, 'OK');
});

test('TLE run streams the finished tests and the verdict', async () => {
  const res = await postSse(STREAM, {
    language: 'javascript',
    code: 'function twoSum(nums, target) { while (target === 6) {} return [0, 1]; }',
    functionName: 'twoSum',
    signature: sig,
    tests,
    limits: { timeMs: 1000 },
  });
  assert.deepEqual(names(res.events), ['running', 'test', 'test', 'test', 'verdict']);
  const [t0, t1, t2] = res.events.filter((e) => e.event === 'test').map((e) => e.data as any);
  assert.equal(t0.passed, true);
  assert.equal(t1.error, 'Time limit exceeded');
  assert.match(t2.error, /^Not run/);
  assert.equal((res.events.at(-1)!.data as any).status, 'TLE');
});

test('heartbeat comments keep a quiet stream alive', async () => {
  const res = await postSse(STREAM, {
    language: 'python',
    code: 'import time\ndef slow():\n    time.sleep(0.5)\n    return 1\n',
    functionName: 'slow',
    tests: [{ input: [], expected: 1 }],
  });
  assert.ok(res.raw.includes(': keep-alive\n\n'), res.raw);
  assert.equal((res.events.at(-1)!.data as any).status, 'OK');
});

test('an invalid request is a plain 400, not a stream', async () => {
  const res = await postSse(STREAM, { language: 'go', code: 'x', functionName: 'f', tests: [{ input: [], expected: 1 }] });
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.raw).error, 'signature: required for go');
});

test('a client disconnect kills the running program', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codemare-abort-'));
  const beat = path.join(dir, 'beat');
  const abort = new AbortController();
  try {
    const res = await fetch(STREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abort.signal,
      body: JSON.stringify({
        language: 'python',
        // Writes a heartbeat file every 20 ms for as long as it lives.
        code: `import time\ndef spin():\n    n = 0\n    while True:\n        n += 1\n        with open(${JSON.stringify(beat)}, 'w') as f:\n            f.write(str(n))\n        time.sleep(0.02)\n`,
        functionName: 'spin',
        tests: [{ input: [], expected: 0 }],
        limits: { timeMs: 10_000 },
      }),
    });
    const reader = res.body!.getReader();
    let text = '';
    while (!text.includes('event: running')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    // Let the program start writing, then hang up.
    let before = '';
    for (let i = 0; i < 100 && before === ''; i++) {
      await new Promise((r) => setTimeout(r, 50));
      before = await readFile(beat, 'utf8').catch(() => '');
    }
    assert.notEqual(before, '', 'the program started');
    abort.abort();
    await new Promise((r) => setTimeout(r, 500));
    const settled = await readFile(beat, 'utf8');
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await readFile(beat, 'utf8'), settled, 'the program was killed after the disconnect');
  } finally {
    abort.abort();
    await rm(dir, { recursive: true, force: true });
  }
  // The service is still healthy afterwards.
  const next = await postJson(`${server.url}/v1/run`, {
    language: 'python',
    code: 'def one():\n    return 1\n',
    functionName: 'one',
    tests: [{ input: [], expected: 1 }],
  });
  assert.equal(next.json.status, 'OK');
});

test('parseSse helper sanity', () => {
  assert.deepEqual(parseSse('event: running\ndata: {}\n\n: keep-alive\n\n'), [
    { event: 'running', data: {} },
    { event: ':', data: 'keep-alive' },
  ]);
});
