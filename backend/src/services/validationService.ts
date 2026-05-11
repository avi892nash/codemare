import { TestCaseResult } from '../models/ExecutionResult.js';
import { TestCase } from '../models/Problem.js';

/**
 * Validate and format test results from the wrapped-code harness. The harness
 * emits per-call `runNs` and `peakBytes`; we surface those as `runMs` and
 * `memoryKb` on each TestCaseResult so the frontend can show algorithm-only
 * timing (excluding interpreter startup).
 */
export function validateResults(
  wrappedResults: Array<{
    output: any;
    expected: any;
    passed: boolean;
    error?: string;
    executionTime?: number;
    runNs?: number;
    peakBytes?: number;
  }>,
  testCases: TestCase[]
): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const wrapped = wrappedResults[i];

    if (!wrapped) {
      results.push({
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        actualOutput: null,
        passed: false,
        executionTime: 0,
        error: 'No result returned from executor',
        hidden: testCase.hidden,
      });
      continue;
    }

    const passed = deepEqual(wrapped.output, wrapped.expected);
    const runMs = wrapped.runNs !== undefined ? wrapped.runNs / 1_000_000 : undefined;
    const memoryKb =
      wrapped.peakBytes !== undefined ? wrapped.peakBytes / 1024 : undefined;

    results.push({
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      actualOutput: wrapped.output,
      passed: passed && !wrapped.error,
      executionTime: runMs ?? wrapped.executionTime ?? 0,
      runMs,
      memoryKb,
      error: wrapped.error,
      hidden: testCase.hidden,
    });
  }

  return results;
}

/**
 * Deep equality check for comparing outputs
 */
export function deepEqual(a: any, b: any): boolean {
  // Handle null/undefined
  if (a === null || a === undefined || b === null || b === undefined) {
    return a === b;
  }

  // Handle primitive types
  if (typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  // Handle objects
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) {
    return false;
  }

  return keysA.every((key) => deepEqual(a[key], b[key]));
}

/**
 * Sanitize test results for frontend (hide hidden test case details)
 */
export function sanitizeResults(results: TestCaseResult[]): TestCaseResult[] {
  return results.map((result) => {
    if (result.hidden) {
      return {
        ...result,
        input: [],
        expectedOutput: null,
        actualOutput: null,
      };
    }
    return result;
  });
}

/**
 * Validate IDE execution request
 */
export function validateIdeRequest(request: any): { valid: boolean; error?: string } {
  // Validate language
  const validLanguages = ['python', 'javascript', 'cpp', 'java'];
  if (!validLanguages.includes(request.language)) {
    return { valid: false, error: 'Invalid language. Must be: python, javascript, cpp, or java' };
  }

  // Validate code
  if (!request.code || typeof request.code !== 'string') {
    return { valid: false, error: 'Code is required and must be a string' };
  }

  if (request.code.trim().length === 0) {
    return { valid: false, error: 'Code cannot be empty' };
  }

  if (request.code.length > 50000) {
    return { valid: false, error: 'Code exceeds maximum size of 50KB' };
  }

  // Validate test cases
  if (!Array.isArray(request.testCases)) {
    return { valid: false, error: 'Test cases must be an array' };
  }

  if (request.testCases.length === 0) {
    return { valid: false, error: 'At least one test case is required' };
  }

  if (request.testCases.length > 10) {
    return { valid: false, error: 'Maximum 10 test cases allowed' };
  }

  // Validate each test case
  for (let i = 0; i < request.testCases.length; i++) {
    const tc = request.testCases[i];

    if (typeof tc.input !== 'string') {
      return { valid: false, error: `Test ${i + 1}: input must be a string` };
    }

    if (typeof tc.expectedOutput !== 'string') {
      return { valid: false, error: `Test ${i + 1}: expectedOutput must be a string` };
    }

    if (tc.input.length > 10000) {
      return { valid: false, error: `Test ${i + 1}: input too large (max 10KB)` };
    }

    if (tc.expectedOutput.length > 100000) {
      return { valid: false, error: `Test ${i + 1}: expected output too large (max 100KB)` };
    }
  }

  return { valid: true };
}
