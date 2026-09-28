// Run with: npx tsx --test tests/run/runValidation.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { RUN_LIMITS, validateRunRequest } from '../../src/services/runValidation.js';

const sig = {
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
  returns: 'int[]',
};

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    language: 'python',
    code: 'def twoSum(nums, target):\n    return [0, 1]\n',
    functionName: 'twoSum',
    signature: sig,
    tests: [{ input: [[2, 7, 11, 15], 9], expected: [0, 1] }],
    ...overrides,
  };
}

function errorOf(body: unknown): string {
  const r = validateRunRequest(body);
  assert.equal(r.ok, false, 'expected a validation failure');
  return r.ok ? '' : r.details.join('\n');
}

test('a minimal valid request gets defaults filled in', () => {
  const r = validateRunRequest(base());
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.compareMode, 'ordered');
  assert.deepEqual(r.value.prelude, []);
  assert.deepEqual(r.value.limits, { timeMs: 10_000, memoryMb: 256 });
  assert.equal(r.value.tests[0].hidden, false);
});

test('language must be one of the six', () => {
  assert.match(errorOf(base({ language: 'rust' })), /language/);
  for (const language of ['python', 'javascript', 'typescript', 'cpp', 'java', 'go']) {
    const code = language === 'java' ? 'class Solution {}' : 'x';
    assert.ok(validateRunRequest(base({ language, code })).ok, language);
  }
});

test('code must be non-empty and at most 64 KB (UTF-8 bytes)', () => {
  assert.match(errorOf(base({ code: '   \n' })), /code: must not be empty/);
  assert.match(errorOf(base({ code: 'x'.repeat(RUN_LIMITS.maxCodeBytes + 1) })), /code: exceeds 64 KB/);
  // 22k three-byte characters = 66 KB of UTF-8 in only 22k UTF-16 units.
  assert.match(errorOf(base({ code: '€'.repeat(22_000) })), /code: exceeds 64 KB/);
  assert.ok(validateRunRequest(base({ code: 'x'.repeat(RUN_LIMITS.maxCodeBytes) })).ok);
});

test('prelude total is capped at 256 KB and java rejects any prelude', () => {
  const big = 'y'.repeat(100 * 1024);
  assert.match(errorOf(base({ prelude: [big, big, big] })), /prelude: exceeds 256 KB/);
  assert.ok(validateRunRequest(base({ prelude: [big, big] })).ok);
  assert.match(
    errorOf(base({ language: 'java', code: 'class Solution {}', prelude: ['class Dep {}'] })),
    /prelude: not supported for java/
  );
  assert.ok(validateRunRequest(base({ language: 'java', code: 'class Solution {}', prelude: [] })).ok);
});

test('signature is required for cpp, java and go only', () => {
  for (const language of ['cpp', 'java', 'go']) {
    assert.match(errorOf(base({ language, signature: undefined })), new RegExp(`signature: required for ${language}`));
  }
  for (const language of ['python', 'javascript', 'typescript']) {
    assert.ok(validateRunRequest(base({ language, code: 'x', signature: undefined })).ok, language);
  }
});

test('signature types and shape are checked', () => {
  assert.match(errorOf(base({ signature: { params: [], returns: 'float' } })), /unsupported type "float"/);
  assert.match(errorOf(base({ signature: { params: [{ name: 'a b', type: 'int' }], returns: 'int' } })), /identifier/);
  assert.match(errorOf(base({ signature: { ...sig, extra: 1 } })), /Unrecognized key/);
});

test('between 1 and 200 tests, each with an input array and an expected value', () => {
  assert.match(errorOf(base({ tests: [] })), /tests/);
  const many = Array.from({ length: RUN_LIMITS.maxTests + 1 }, () => ({ input: [[1], 1], expected: [0] }));
  assert.match(errorOf(base({ tests: many })), /tests/);
  assert.match(errorOf(base({ tests: [{ input: 5, expected: 1 }] })), /tests\[0\]\.input/);
  assert.match(errorOf(base({ tests: [{ input: [[1], 1] }] })), /tests\[0\]\.expected: Required/);
  // null is a legitimate expected value; unknown per-test keys are dropped.
  const r = validateRunRequest(
    base({ signature: undefined, tests: [{ input: [[1], 1], expected: null, explain_on_fail: 'x' }] })
  );
  assert.ok(r.ok);
});

test('per-test and total test sizes and nesting depth are capped', () => {
  const huge = Array.from({ length: 120_000 }, (_, i) => i);
  assert.match(errorOf(base({ tests: [{ input: [huge, 1], expected: [0, 1] }] })), /tests\[0\]: input \+ expected exceed 512 KB/);
  const chunk = Array.from({ length: 50_000 }, () => 123456);
  const tests = Array.from({ length: 12 }, () => ({ input: [chunk, 1], expected: [0, 1] }));
  assert.match(errorOf(base({ tests })), /tests: exceed 4 MB in total/);
  let deep: unknown = 1;
  for (let i = 0; i < 40; i++) deep = [deep];
  assert.match(errorOf(base({ signature: undefined, tests: [{ input: [deep], expected: 1 }] })), /nested deeper/);
});

test('limits are integers capped at 10 s and 512 MB', () => {
  assert.match(errorOf(base({ limits: { timeMs: 10_001 } })), /limits\.timeMs/);
  assert.match(errorOf(base({ limits: { memoryMb: 513 } })), /limits\.memoryMb/);
  assert.match(errorOf(base({ limits: { timeMs: 1.5 } })), /limits\.timeMs/);
  assert.match(errorOf(base({ limits: { timeMs: 50 } })), /limits\.timeMs/);
  const r = validateRunRequest(base({ limits: { timeMs: 2000, memoryMb: 512 } }));
  assert.ok(r.ok && r.value.limits.timeMs === 2000 && r.value.limits.memoryMb === 512);
});

test('misspelt top-level keys are rejected instead of silently ignored', () => {
  assert.match(errorOf(base({ compare_mode: 'unordered' })), /Unrecognized key.*compare_mode/);
  assert.match(errorOf(base({ compareMode: 'sorted' })), /compareMode/);
});

test('functionName must be a safe identifier and not collide with the harness', () => {
  assert.match(errorOf(base({ functionName: 'two sum' })), /functionName/);
  assert.match(errorOf(base({ functionName: 'x); import os; (' })), /functionName/);
  assert.match(errorOf(base({ functionName: '__cmRun' })), /reserved for the harness/);
  assert.match(errorOf(base({ language: 'go', functionName: 'main' })), /"main" is reserved in go/);
  assert.match(errorOf(base({ language: 'go', functionName: 'init' })), /"init" is reserved in go/);
  assert.match(errorOf(base({ language: 'cpp', functionName: 'main' })), /"main" is reserved in cpp/);
  assert.ok(validateRunRequest(base({ functionName: 'main' })).ok, 'python may call its function main');
});

test('test arity must match the signature in every language', () => {
  for (const language of ['python', 'go']) {
    assert.match(
      errorOf(base({ language, tests: [{ input: [[1, 2]], expected: [0] }] })),
      /tests\[0\]\.input: has 1 value\(s\) but the signature declares 2/
    );
  }
});

test('typed languages check every value against the signature', () => {
  const cpp = (tests: unknown[], signature: unknown = sig) =>
    base({ language: 'cpp', code: 'x', signature, tests });
  assert.match(errorOf(cpp([{ input: [[1, 'two'], 3], expected: [0, 1] }])), /tests\[0\]\.input\[0\]\[1\]: expected int/);
  assert.match(errorOf(cpp([{ input: [[1, 2], 2 ** 31], expected: [0, 1] }])), /input\[1\]: expected int \(32-bit/);
  assert.match(errorOf(cpp([{ input: [[1, 2], 3], expected: null }])), /tests\[0\]\.expected: expected int\[\]/);
  assert.match(errorOf(cpp([{ input: [[1, 2], 3], expected: [0.5] }])), /expected\[0\]: expected int/);
  const charSig = { params: [{ name: 'c', type: 'char' }], returns: 'long' };
  assert.match(errorOf(cpp([{ input: ['é'], expected: 1 }], charSig)), /single ASCII character/);
  assert.match(errorOf(cpp([{ input: ['a'], expected: 2 ** 60 }], charSig)), /expected long/);
  // Java's char is a UTF-16 unit, so 'é' is fine there.
  assert.ok(
    validateRunRequest(base({ language: 'java', code: 'x', signature: charSig, tests: [{ input: ['é'], expected: 1 }] })).ok
  );
  // Dynamic languages don't enforce value types (only arity).
  assert.ok(validateRunRequest(base({ tests: [{ input: [[1, 'two'], 3], expected: null }] })).ok);
});
