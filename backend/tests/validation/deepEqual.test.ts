// Run with: npx tsx --test tests/validation/deepEqual.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  deepEqual,
  deriveVerdict,
  validateResults,
} from '../../src/services/validationService.js';
import { TestCase } from '../../src/models/Problem.js';

test('ordered mode (default) is order-sensitive', () => {
  assert.equal(deepEqual([0, 1], [0, 1]), true);
  assert.equal(deepEqual([1, 0], [0, 1]), false);
  assert.equal(deepEqual([1, 0], [0, 1], 'ordered'), false);
});

test('unordered mode compares arrays as multisets', () => {
  assert.equal(deepEqual([1, 0], [0, 1], 'unordered'), true);
  assert.equal(deepEqual([2, 4], [4, 2], 'unordered'), true);
  assert.equal(deepEqual([0, 1], [0, 2], 'unordered'), false);
  // Multiset, not set: duplicate counts must match.
  assert.equal(deepEqual([1, 1, 2], [1, 2, 2], 'unordered'), false);
  assert.equal(deepEqual([1, 1, 2], [2, 1, 1], 'unordered'), true);
  // Length mismatch still fails.
  assert.equal(deepEqual([0, 1], [0, 1, 2], 'unordered'), false);
});

test('unordered mode applies recursively to nested arrays', () => {
  assert.equal(
    deepEqual(
      [
        [3, 1],
        [2, 0],
      ],
      [
        [0, 2],
        [1, 3],
      ],
      'unordered'
    ),
    true
  );
});

test('unordered mode leaves primitives and objects alone', () => {
  assert.equal(deepEqual(42, 42, 'unordered'), true);
  assert.equal(deepEqual('ab', 'ba', 'unordered'), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1 }, 'unordered'), true);
});

test('validateResults honours compareMode when re-checking outputs', () => {
  const testCases: TestCase[] = [
    { input: [[2, 7], 9], expectedOutput: [0, 1], hidden: false },
  ];
  const wrapped = [{ output: [1, 0], expected: [0, 1], passed: true }];

  const ordered = validateResults(wrapped, testCases);
  assert.equal(ordered[0].passed, false);

  const unordered = validateResults(wrapped, testCases, 'unordered');
  assert.equal(unordered[0].passed, true);
});

test('deriveVerdict turns a clean exit with failing tests into WA', () => {
  assert.equal(deriveVerdict('OK', 5, 5), 'OK');
  assert.equal(deriveVerdict('OK', 0, 5), 'WA');
  assert.equal(deriveVerdict('OK', 4, 5), 'WA');
});

test('deriveVerdict passes real sandbox statuses through untouched', () => {
  assert.equal(deriveVerdict('TLE', 0, 5), 'TLE');
  assert.equal(deriveVerdict('RE', 2, 5), 'RE');
  assert.equal(deriveVerdict('CE', 0, 5), 'CE');
  assert.equal(deriveVerdict('MLE', 0, 5), 'MLE');
  assert.equal(deriveVerdict('XX', 0, 5), 'XX');
  assert.equal(deriveVerdict(undefined, 0, 5), undefined);
});
