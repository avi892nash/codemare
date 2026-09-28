// Run with: npx tsx --test tests/run/runEndpoint.test.ts
//
// POST /v1/run end to end through the real Express app and the local sandbox
// adapter (needs python3, node, g++, javac and go on PATH — as CI has).
import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { postJson, startTestServer, TestServer } from './httpHarness.js';

let server: TestServer;
let RUN: string;

before(async () => {
  server = await startTestServer();
  RUN = `${server.url}/v1/run`;
});
after(async () => {
  await server.close();
});

const twoSumSig = {
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
  returns: 'int[]',
};
const twoSumTests = [
  { input: [[2, 7, 11, 15], 9], expected: [0, 1] },
  { input: [[3, 2, 4], 6], expected: [1, 2] },
  { input: [[3, 3], 6], expected: [0, 1], hidden: true },
];
const PY_TWO_SUM = `def twoSum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
    return []
`;

function twoSum(language: string, code: string, extra: Record<string, unknown> = {}) {
  return {
    language,
    code,
    functionName: 'twoSum',
    signature: twoSumSig,
    compareMode: 'unordered',
    tests: twoSumTests,
    ...extra,
  };
}

test('OK: per-test results carry idx, hidden, passed, runUs, wallUs, memoryKb, actual', async () => {
  const { status, json } = await postJson(RUN, twoSum('python', PY_TWO_SUM));
  assert.equal(status, 200);
  assert.equal(json.status, 'OK');
  assert.equal(json.totalPassed, 3);
  assert.equal(json.totalTests, 3);
  assert.equal(json.tests.length, 3);
  json.tests.forEach((t: any, i: number) => {
    assert.equal(t.idx, i);
    assert.equal(t.passed, true);
    assert.equal(typeof t.runUs, 'number');
    assert.equal(typeof t.wallUs, 'number');
    assert.equal(typeof t.memoryKb, 'number');
    assert.equal(t.error, undefined);
  });
  assert.deepEqual(json.tests.map((t: any) => t.hidden), [false, false, true]);
  assert.deepEqual(json.tests[1].actual, [1, 2]);
  assert.equal(json.runUs, json.tests.reduce((s: number, t: any) => s + t.runUs, 0));
  assert.equal(json.compileMs, undefined);
});

test('WA: a clean run with a wrong answer; a per-test exception is a failed test', async () => {
  const wrong = await postJson(RUN, twoSum('python', 'def twoSum(nums, target):\n    return [0, 0]\n'));
  assert.equal(wrong.json.status, 'WA');
  assert.equal(wrong.json.totalPassed, 0);
  assert.deepEqual(wrong.json.tests[0].actual, [0, 0]);

  const raising = await postJson(
    RUN,
    twoSum('python', `${PY_TWO_SUM}\n_orig = twoSum\ndef twoSum(nums, target):\n    if target == 6:\n        return 1 // 0\n    return _orig(nums, target)\n`)
  );
  assert.equal(raising.json.status, 'WA');
  assert.equal(raising.json.totalPassed, 1);
  assert.equal(raising.json.tests[1].error, 'ZeroDivisionError: integer division or modulo by zero');
  assert.equal(raising.json.tests[1].actual, null);
});

test('the learner’s own prints never break judging', async () => {
  const noisy = PY_TWO_SUM.replace('    seen = {}', '    print("debug", nums, end="")\n    seen = {}');
  const { json } = await postJson(RUN, twoSum('python', noisy));
  assert.equal(json.status, 'OK');
});

test('expected values never reach a Python/JS program', async () => {
  // The harness's own test list is visible to user code; it holds no answers.
  const peek = await postJson(RUN, twoSum('python', 'def twoSum(nums, target):\n    return _cm_tests[0]["expected"]\n'));
  assert.equal(peek.json.status, 'WA');
  assert.equal(peek.json.tests[0].actual, null);
  const peekJs = await postJson(RUN, twoSum('javascript', 'function twoSum() { return __cm_tests[0].expected; }'));
  assert.equal(peekJs.json.status, 'WA');
});

test('CE: syntax errors in python, javascript and typescript, compile errors in cpp and go', async () => {
  const py = await postJson(RUN, twoSum('python', 'def twoSum(nums, target):\n    return [0,\n'));
  assert.equal(py.json.status, 'CE');
  assert.deepEqual(py.json.tests, []);
  assert.match(py.json.error, /File "solution\.py", line \d/);
  assert.match(py.json.error, /SyntaxError/);

  const js = await postJson(RUN, twoSum('javascript', 'function twoSum(nums, target) {\n  return nums target;\n}\n'));
  assert.equal(js.json.status, 'CE');
  assert.match(js.json.error, /^solution\.js:2\n/);
  assert.match(js.json.error, /SyntaxError: Unexpected identifier/);

  const ts = await postJson(RUN, twoSum('typescript', 'function twoSum(nums: number[], target: number): number[] {\n  const x = ;\n  return [];\n}\n'));
  assert.equal(ts.json.status, 'CE');
  assert.match(ts.json.error, /^solution\.ts:2:13 - error TS1109: Expression expected\./);
  assert.equal(typeof ts.json.compileMs, 'number');

  const cpp = await postJson(RUN, twoSum('cpp', 'std::vector<int> twoSum(std::vector<int>& nums, int target) {\n    return nums.size() + ;\n}\n'));
  assert.equal(cpp.json.status, 'CE');
  assert.match(cpp.json.error, /solution\.cpp:2:\d+: error/);

  const go = await postJson(RUN, twoSum('go', 'import "fmt"\n\nfunc twoSum(nums []int, target int) []int {\n\treturn missing\n}\n'));
  assert.equal(go.json.status, 'CE');
  assert.match(go.json.error, /solution\.go:4:\d+: undefined: missing/);
  assert.match(go.json.error, /solution\.go:1:8: "fmt" imported and not used/);
  assert.ok(!go.json.error.includes('# command-line-arguments'));
});

test('TLE: tests before the slow one keep their results; the rest are not run', async () => {
  const { json } = await postJson(
    RUN,
    twoSum('python', 'def twoSum(nums, target):\n    while target == 6:\n        pass\n    return [0, 1]\n', {
      limits: { timeMs: 1000 },
    })
  );
  assert.equal(json.status, 'TLE');
  assert.equal(json.error, 'Time limit exceeded (1000 ms)');
  assert.equal(json.totalPassed, 1);
  assert.equal(json.tests[0].passed, true);
  assert.equal(json.tests[1].error, 'Time limit exceeded');
  assert.match(json.tests[2].error, /^Not run/);
});

test('RE: a crash, a non-zero exit and an early clean exit', async () => {
  const segv = await postJson(
    RUN,
    twoSum('cpp', 'std::vector<int> twoSum(std::vector<int>& nums, int target) {\n    if (target == 6) { volatile int* p = nullptr; *p = 1; }\n    return {0, 1};\n}\n')
  );
  assert.equal(segv.json.status, 'RE');
  assert.equal(segv.json.tests[0].passed, true);
  assert.match(segv.json.tests[1].error, /^Runtime error/);

  const exit3 = await postJson(RUN, twoSum('python', 'import sys\ndef twoSum(nums, target):\n    sys.exit(3)\n'));
  assert.equal(exit3.json.status, 'RE');
  assert.equal(exit3.json.tests.length, 3);

  const clean = await postJson(RUN, twoSum('python', 'import os\ndef twoSum(nums, target):\n    if target == 6:\n        os._exit(0)\n    return [0, 1]\n'));
  assert.equal(clean.json.status, 'RE');
  assert.match(clean.json.error, /exited before all tests ran/);
  assert.equal(clean.json.tests[0].passed, true);
});

test('RE summaries lead with the line that says what happened', async () => {
  // Go prints the reason first and a long stack dump after it.
  const go = await postJson(
    RUN,
    twoSum('go', 'import "runtime/debug"\n\nfunc init() { debug.SetMaxStack(32 << 20) }\n\nfunc twoSum(nums []int, target int) []int {\n\tif target == 6 {\n\t\treturn twoSum(nums, target)\n\t}\n\treturn []int{0, 1}\n}\n')
  );
  assert.equal(go.json.status, 'RE');
  assert.equal(go.json.tests[1].error, 'Runtime error: fatal error: stack overflow');
  assert.match(go.json.error, /^runtime: goroutine stack exceeds/);
  // Python prints it last, after the traceback.
  const py = await postJson(RUN, twoSum('python', 'import sys\nsys.setrecursionlimit(10**6)\ndef twoSum(nums, target):\n    raise SystemExit("bye")\n'));
  assert.equal(py.json.status, 'RE');
  assert.equal(py.json.tests[0].error, 'Runtime error: bye');
  // Node: an uncaught error at load time, mapped to the learner's line.
  const js = await postJson(RUN, twoSum('javascript', 'function twoSum() { return [0, 1]; }\nnull.boom;\n', { prelude: ['// dep\n'] }));
  assert.equal(js.json.status, 'RE');
  assert.equal(js.json.tests[0].error, "Runtime error: TypeError: Cannot read properties of null (reading 'boom')");
  assert.match(js.json.error, /^solution\.js:2\n/);
});

test('learner-controlled stderr is post-processed in linear time', async () => {
  // A path-like token that made an earlier backtracking regex take forever.
  const started = Date.now();
  const { json } = await postJson(RUN, {
    language: 'python',
    code: 'import sys\ndef f():\n    sys.stderr.write("/a" * 20000 + "!")\n    sys.exit(1)\n',
    functionName: 'f',
    tests: [{ input: [], expected: 1 }],
  });
  assert.equal(json.status, 'RE');
  assert.ok(Date.now() - started < 5_000, `took ${Date.now() - started} ms`);
});

test('doubles compare with a 1e-6 tolerance only when the signature returns double', async () => {
  const add = (sigReturns?: string) => ({
    language: 'python',
    code: 'def add(a, b):\n    return a + b\n',
    functionName: 'add',
    ...(sigReturns
      ? { signature: { params: [{ name: 'a', type: 'double' }, { name: 'b', type: 'double' }], returns: sigReturns } }
      : {}),
    tests: [{ input: [0.1, 0.2], expected: 0.3 }],
  });
  assert.equal((await postJson(RUN, add('double'))).json.status, 'OK');
  assert.equal((await postJson(RUN, add())).json.status, 'WA');
});

test('unordered compare is recursive (multisets of multisets)', async () => {
  const { json } = await postJson(RUN, {
    language: 'javascript',
    code: 'function pairs() { return [[3, 1], [0, 2]]; }',
    functionName: 'pairs',
    compareMode: 'unordered',
    tests: [{ input: [], expected: [[1, 3], [2, 0]] }],
  });
  assert.equal(json.status, 'OK');
});

test('typescript, java and go run through their harnesses', async () => {
  const ts = await postJson(
    RUN,
    twoSum('typescript', 'function twoSum(nums: number[], target: number): number[] {\n  const seen = new Map<number, number>();\n  for (let i = 0; i < nums.length; i++) {\n    const j = seen.get(target - nums[i]);\n    if (j !== undefined) return [j, i];\n    seen.set(nums[i], i);\n  }\n  return [];\n}\n')
  );
  assert.equal(ts.json.status, 'OK');
  assert.equal(typeof ts.json.compileMs, 'number');

  const java = await postJson(
    RUN,
    twoSum('java', 'import java.util.*;\nclass Solution {\n  public static int[] twoSum(int[] nums, int target) {\n    Map<Integer, Integer> seen = new HashMap<>();\n    for (int i = 0; i < nums.length; i++) {\n      Integer j = seen.get(target - nums[i]);\n      if (j != null) return new int[]{j, i};\n      seen.put(nums[i], i);\n    }\n    return new int[0];\n  }\n}\n')
  );
  assert.equal(java.json.status, 'OK');
  assert.equal(typeof java.json.compileMs, 'number');

  const go = await postJson(
    RUN,
    twoSum('go', 'func twoSum(nums []int, target int) []int {\n\tseen := map[int]int{}\n\tfor i, n := range nums {\n\t\tif j, ok := seen[target-n]; ok {\n\t\t\treturn []int{j, i}\n\t\t}\n\t\tseen[n] = i\n\t}\n\treturn nil\n}\n', {
      prelude: ['import "sort"\n\nfunc unused(a []int) { sort.Ints(a) }\n'],
    })
  );
  assert.equal(go.json.status, 'OK', JSON.stringify(go.json));
});

test('validation failures are 400 {error, details}', async () => {
  const { status, json } = await postJson(RUN, { language: 'cpp', code: 'x', functionName: 'f', tests: [{ input: [], expected: 1 }] });
  assert.equal(status, 400);
  assert.equal(json.error, 'signature: required for cpp');
  assert.ok(Array.isArray(json.details));
  const bad = await postJson(RUN, '{"language":');
  assert.equal(bad.status, 400);
});

test('bodies up to the run limit are accepted (beyond the app-wide 1 MB)', async () => {
  const big = Array.from({ length: 60_000 }, (_, i) => i); // ~350 KB per test
  const tests = Array.from({ length: 5 }, () => ({ input: [big], expected: 60_000 }));
  const { status, json } = await postJson(RUN, {
    language: 'python',
    code: 'def size(a):\n    return len(a)\n',
    functionName: 'size',
    tests,
  });
  assert.equal(status, 200);
  assert.equal(json.status, 'OK');
  const tooBig = await postJson(RUN, JSON.stringify({ language: 'python', code: 'x'.repeat(7 * 1024 * 1024) }));
  assert.equal(tooBig.status, 413);
});
