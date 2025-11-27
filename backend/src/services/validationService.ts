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
