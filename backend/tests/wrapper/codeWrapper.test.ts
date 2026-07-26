// Run with: npx tsx --test tests/wrapper/codeWrapper.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  cppLiteral,
  cppStringLiteral,
  javaLiteral,
  javaStringLiteral,
  parseSignatureType,
  wrapFunctionCode,
} from '../../src/services/codeWrapperService.js';
import { ProblemSignature, TestCase } from '../../src/models/Problem.js';

const execFileAsync = promisify(execFile);

const PROBLEMS_DIR = fileURLToPath(new URL('../../src/data/problems', import.meta.url));

interface LoadedProblem {
  starterCode: { java: string };
  functionName: string;
  compareMode?: 'ordered' | 'unordered';
  signature?: ProblemSignature;
  testCases: TestCase[];
}

async function loadProblem(id: string): Promise<LoadedProblem> {
  return JSON.parse(await readFile(path.join(PROBLEMS_DIR, `${id}.json`), 'utf8'));
}

const twoSumSignature: ProblemSignature = {
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
  returns: 'int[]',
};

const twoSumTests: TestCase[] = [
  { input: [[2, 7, 11, 15], 9], expectedOutput: [0, 1], hidden: false },
  { input: [[3, 2, 4], 6], expectedOutput: [1, 2], hidden: false },
];

test('parseSignatureType handles scalars, arrays and matrices', () => {
  assert.deepEqual(parseSignatureType('int'), { base: 'int', dims: 0 });
  assert.deepEqual(parseSignatureType('string[]'), { base: 'string', dims: 1 });
  assert.deepEqual(parseSignatureType('double[][]'), { base: 'double', dims: 2 });
  assert.throws(() => parseSignatureType('float' as never), /Unsupported signature type/);
});

test('cppLiteral emits typed literals for every supported type', () => {
  assert.equal(cppLiteral('int', 42), '42');
  assert.equal(cppLiteral('int', -7), '-7');
  assert.equal(cppLiteral('long', 9007199254740991), '9007199254740991LL');
  assert.equal(cppLiteral('double', 0.5), '0.5');
  assert.equal(cppLiteral('double', 5), '5.0'); // integer-notation doubles get a fraction
  assert.equal(cppLiteral('bool', true), 'true');
  assert.equal(cppLiteral('bool', false), 'false');
  assert.equal(cppLiteral('char', 'x'), "'x'");
  assert.equal(cppLiteral('string', 'hi'), 'std::string("hi")');
  assert.equal(cppLiteral('int[]', [2, 7, 11]), 'std::vector<int>{2, 7, 11}');
  assert.equal(cppLiteral('int[]', []), 'std::vector<int>{}');
  assert.equal(
    cppLiteral('int[][]', [[1, 2], []]),
    'std::vector<std::vector<int>>{std::vector<int>{1, 2}, std::vector<int>{}}'
  );
  assert.equal(
    cppLiteral('string[]', ['a', 'b']),
    'std::vector<std::string>{std::string("a"), std::string("b")}'
  );
  assert.equal(cppLiteral('double[]', [1.5, 2]), 'std::vector<double>{1.5, 2.0}');
  assert.equal(cppLiteral('bool[]', [true, false]), 'std::vector<bool>{true, false}');
  assert.equal(cppLiteral('char[]', ['h', 'i']), "std::vector<char>{'h', 'i'}");
});

test('javaLiteral emits typed literals for every supported type', () => {
  assert.equal(javaLiteral('int', 42), '42');
  assert.equal(javaLiteral('long', 123), '123L');
  assert.equal(javaLiteral('double', 5), '5.0');
  assert.equal(javaLiteral('bool', true), 'true');
  assert.equal(javaLiteral('char', 'x'), "'x'");
  assert.equal(javaLiteral('string', 'hi'), '"hi"');
  assert.equal(javaLiteral('int[]', [2, 7, 11]), 'new int[]{2, 7, 11}');
  assert.equal(javaLiteral('int[]', []), 'new int[]{}');
  assert.equal(javaLiteral('int[][]', [[1, 2], []]), 'new int[][]{{1, 2}, {}}');
  assert.equal(javaLiteral('string[]', ['a', 'b']), 'new String[]{"a", "b"}');
  assert.equal(javaLiteral('double[]', [1.5, 2]), 'new double[]{1.5, 2.0}');
  assert.equal(javaLiteral('bool[]', [true, false]), 'new boolean[]{true, false}');
  assert.equal(javaLiteral('char[]', ['h', 'i']), "new char[]{'h', 'i'}");
});

test('string literals escape quotes, backslashes and control characters', () => {
  assert.equal(cppStringLiteral('say "hi"'), '"say \\"hi\\""');
  assert.equal(cppStringLiteral('a\\b'), '"a\\\\b"');
  assert.equal(cppStringLiteral('line1\nline2\ttab'), '"line1\\nline2\\ttab"');
  assert.equal(cppStringLiteral(''), '"\\001"');

  assert.equal(javaStringLiteral('say "hi"'), '"say \\"hi\\""');
  assert.equal(javaStringLiteral('a\\b'), '"a\\\\b"');
  assert.equal(javaStringLiteral('line1\nline2\ttab'), '"line1\\nline2\\ttab"');
  // Non-ASCII is emitted as \uXXXX so the file is javac-charset-independent.
  assert.equal(javaStringLiteral('é'), '"\\u00e9"');
});

test('char literals escape quotes and backslashes', () => {
  assert.equal(cppLiteral('char', "'"), "'\\''");
  assert.equal(cppLiteral('char', '\\'), "'\\\\'");
  assert.equal(cppLiteral('char', '\n'), "'\\n'");
  assert.equal(javaLiteral('char', "'"), "'\\''");
  assert.equal(javaLiteral('char', '\\'), "'\\\\'");
  assert.equal(javaLiteral('char', '\n'), "'\\n'");
});

test('mismatched test data throws a descriptive error', () => {
  assert.throws(() => cppLiteral('int', 'oops'), /does not match signature/);
  assert.throws(() => cppLiteral('int', 1.5), /does not match signature/);
  assert.throws(() => cppLiteral('int[]', 5), /does not match signature/);
  assert.throws(() => cppLiteral('char', 'ab'), /single ASCII character/);
  assert.throws(() => javaLiteral('bool', 1), /does not match signature/);
  assert.throws(() => javaLiteral('char', 'ab'), /single character/);
});

test('cpp wrapper embeds typed literals, monotonic timing and the user call', () => {
  const { wrappedCode, input } = wrapFunctionCode(
    'std::vector<int> twoSum(std::vector<int>& nums, int target) { return {}; }',
    'twoSum',
    twoSumTests,
    'cpp',
    'unordered',
    twoSumSignature
  );
  assert.equal(input, ''); // no runtime JSON parsing — everything is embedded
  assert.ok(wrappedCode.includes('std::vector<int> __p0 = std::vector<int>{2, 7, 11, 15};'));
  assert.ok(wrappedCode.includes('int __p1 = 9;'));
  assert.ok(wrappedCode.includes('std::vector<int> __exp = std::vector<int>{0, 1};'));
  assert.ok(wrappedCode.includes('std::chrono::steady_clock'));
  assert.ok(wrappedCode.includes('twoSum(__p0, __p1)'));
  assert.ok(wrappedCode.includes('__cm_canon(__res);')); // unordered honored
  assert.ok(wrappedCode.includes('int main()'));
  // Per-test exceptions are caught with labeled types (D3).
  assert.ok(wrappedCode.includes('catch (const std::out_of_range& __e)'));
  assert.ok(wrappedCode.includes('"out_of_range: "'));
  assert.ok(wrappedCode.includes('catch (const std::exception& __e)'));
});

test('cpp wrapper omits canonicalisation for ordered problems', () => {
  const { wrappedCode } = wrapFunctionCode(
    'code',
    'twoSum',
    twoSumTests,
    'cpp',
    'ordered',
    twoSumSignature
  );
  assert.ok(!wrappedCode.includes('__cm_canon(__res);'));
});

test('java wrapper embeds typed literals and calls Solution.<fn>', () => {
  const { wrappedCode, input } = wrapFunctionCode(
    'class Solution { public static int[] twoSum(int[] nums, int target) { return null; } }',
    'twoSum',
    twoSumTests,
    'java',
    'unordered',
    twoSumSignature
  );
  assert.equal(input, '');
  assert.ok(wrappedCode.includes('public class Main'));
  assert.ok(wrappedCode.includes('int[] p0 = new int[]{2, 7, 11, 15};'));
  assert.ok(wrappedCode.includes('int p1 = 9;'));
  assert.ok(wrappedCode.includes('int[] exp = new int[]{0, 1};'));
  assert.ok(wrappedCode.includes('System.nanoTime()'));
  assert.ok(wrappedCode.includes('Solution.twoSum(p0, p1)'));
  assert.ok(wrappedCode.includes('canon(res);')); // unordered honored
});

test('cpp/java without a signature fall back to the structured error stub', () => {
  for (const language of ['cpp', 'java'] as const) {
    const { wrappedCode } = wrapFunctionCode('code', 'f', twoSumTests, language);
    assert.ok(wrappedCode.includes("doesn't support"));
    assert.ok(wrappedCode.includes('results'));
  }
});

test('arity mismatch between tests and signature throws', () => {
  assert.throws(
    () =>
      wrapFunctionCode(
        'code',
        'f',
        [{ input: [1], expectedOutput: 1, hidden: false }],
        'cpp',
        'ordered',
        twoSumSignature
      ),
    /declares 2 parameter/
  );
});

test('large java array literals are hoisted into chunked builder methods', async () => {
  const problem = await loadProblem('binary-search');
  const { wrappedCode } = wrapFunctionCode(
    problem.starterCode.java,
    problem.functionName,
    problem.testCases,
    'java',
    problem.compareMode ?? 'ordered',
    problem.signature
  );
  // The 10k-element hidden test must not be inlined into a test method.
  assert.ok(wrappedCode.includes('static int[] __lit0()'));
  assert.ok(wrappedCode.includes('__lit0_c0()'));
  assert.ok(wrappedCode.includes('__fill(a, o,'));
  assert.ok(wrappedCode.includes('static void __test1()'));
  assert.ok(wrappedCode.includes('__test1();'));
  // No emitted chunk method should carry more than ~JAVA_CHUNK_WEIGHT scalars
  // (bounded source line length is a cheap proxy: 400 ints < 6KB of source).
  for (const line of wrappedCode.split('\n')) {
    if (line.includes('_c') && line.includes('return new ')) {
      assert.ok(line.length < 8192, `chunk method line too long (${line.length})`);
    }
  }
});

test('long java string constants are split across StringBuilder appends', async () => {
  const problem = await loadProblem('longest-substring-without-repeating-characters');
  const { wrappedCode } = wrapFunctionCode(
    problem.starterCode.java,
    problem.functionName,
    problem.testCases,
    'java',
    problem.compareMode ?? 'ordered',
    problem.signature
  );
  // The ~20k-char hidden input must be hoisted into a StringBuilder builder
  // (capacity = exact string length, always > the 16000-char chunk threshold).
  assert.match(wrappedCode, /new StringBuilder\((1[7-9]|[2-9]\d)\d{3}\)/);
  assert.ok(wrappedCode.includes('static String __lit0()'));
  // No single emitted string constant may approach the 64KB UTF-8 cap.
  const constants = wrappedCode.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  for (const c of constants) {
    assert.ok(c.length < 50000, `string constant too long (${c.length})`);
  }
});

// The definitive D1 regression: the generated Main.java for every problem
// whose test data previously blew the JVM's 64KB-per-method limit must
// actually compile. Uses the verbatim Java starter stub, which also proves
// the stubs themselves compile (D2).
test('generated Main.java compiles under javac for large-input problems', async () => {
  const problems = [
    'contains-duplicate',
    'best-time-to-buy-sell-stock',
    'binary-search',
    'maximum-subarray',
    'longest-substring-without-repeating-characters',
  ];
  for (const id of problems) {
    const problem = await loadProblem(id);
    const { wrappedCode } = wrapFunctionCode(
      problem.starterCode.java,
      problem.functionName,
      problem.testCases,
      'java',
      problem.compareMode ?? 'ordered',
      problem.signature
    );
    const dir = await mkdtemp(path.join(os.tmpdir(), 'codemare-javac-test-'));
    try {
      const mainFile = path.join(dir, 'Main.java');
      await writeFile(mainFile, wrappedCode);
      await assert.doesNotReject(
        () => execFileAsync('javac', [mainFile], { cwd: dir }),
        `javac failed for ${id}`
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('python and javascript wrappers are untouched by the signature param', () => {
  const py = wrapFunctionCode('def f():\n    pass', 'f', twoSumTests, 'python', 'ordered');
  const pySig = wrapFunctionCode(
    'def f():\n    pass',
    'f',
    twoSumTests,
    'python',
    'ordered',
    twoSumSignature
  );
  assert.equal(py.wrappedCode, pySig.wrappedCode);
  assert.equal(py.input, pySig.input);

  const js = wrapFunctionCode('function f() {}', 'f', twoSumTests, 'javascript', 'unordered');
  const jsSig = wrapFunctionCode(
    'function f() {}',
    'f',
    twoSumTests,
    'javascript',
    'unordered',
    twoSumSignature
  );
  assert.equal(js.wrappedCode, jsSig.wrappedCode);
});
