import { Language } from './ExecutionResult.js';

/**
 * Single test case with stdin input and expected stdout output
 */
export interface IdeTestCase {
  input: string;           // String to feed to stdin (can be multiline)
  expectedOutput: string;  // Expected stdout output (exact match)
}

/**
 * Request for IDE code execution
 */
export interface IdeExecutionRequest {
  code: string;            // Complete user code
  language: Language;      // python | javascript | cpp | java
  testCases: IdeTestCase[]; // 1-10 test cases
}

/**
 * Result for a single test case execution
 */
export interface IdeTestResult {
  input: string;
  expectedOutput: string;
  actualOutput: string;
  passed: boolean;
  executionTime: number;  // milliseconds
  error?: string;         // Runtime error if any
}

/**
 * Response for IDE execution
 */
export interface IdeExecutionResponse {
  success: boolean;        // All tests passed
  testResults: IdeTestResult[];
  totalPassed: number;
  totalTests: number;
  totalExecutionTime: number;
  error?: string;          // Compilation or system error
}
