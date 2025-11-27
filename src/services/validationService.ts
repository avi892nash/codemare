import { TestCaseResult } from '../models/ExecutionResult.js';
import { TestCase } from '../models/Problem.js';

/**
 * Validate and format test results from Docker executor
 */
export function validateResults(
  dockerResults: Array<{
    output: any;
    expected: any;
    passed: boolean;
    error?: string;
    executionTime?: number;
  }>,
  testCases: TestCase[]
): TestCaseResult[] {
  const results: TestCaseResult[] = [];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    const dockerResult = dockerResults[i];

    if (!dockerResult) {
      // If Docker didn't return a result for this test case
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

    // Deep equality check for complex types
    const passed = deepEqual(dockerResult.output, dockerResult.expected);

    results.push({
      input: testCase.input,
      expectedOutput: testCase.expectedOutput,
      actualOutput: dockerResult.output,
      passed: passed && !dockerResult.error,
      executionTime: dockerResult.executionTime || 0,
      error: dockerResult.error,
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
