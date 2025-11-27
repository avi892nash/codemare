import { executeInDocker } from './dockerService.js';
import {
  IdeExecutionRequest,
  IdeExecutionResponse,
  IdeTestResult,
} from '../models/IdeExecution.js';

/**
 * Execute code with custom test cases (stdin/stdout mode)
 * Runs code once per test case
 */
export async function executeIdeCode(
  request: IdeExecutionRequest
): Promise<IdeExecutionResponse> {
  const results: IdeTestResult[] = [];
  const startTime = Date.now();

  try {
    // Execute each test case separately
    for (const testCase of request.testCases) {
      const testStartTime = Date.now();

      try {
        // Execute code directly (no wrapping)
        const dockerResult = await executeInDocker(
          request.language,
          request.code, // User code as-is
          testCase.input // Test input as-is
        );

        const executionTime = Date.now() - testStartTime;
        const actualOutput = dockerResult.output || '';
        const passed =
          actualOutput === testCase.expectedOutput && !dockerResult.error;

        results.push({
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: actualOutput,
          passed: passed,
          executionTime: executionTime,
          error: dockerResult.error,
        });
      } catch (error) {
        results.push({
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: '',
          passed: false,
          executionTime: Date.now() - testStartTime,
          error:
            error instanceof Error ? error.message : 'Execution failed',
        });
      }
    }

    const totalPassed = results.filter((r) => r.passed).length;

    return {
      success: totalPassed === results.length,
      testResults: results,
      totalPassed: totalPassed,
      totalTests: results.length,
      totalExecutionTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      testResults: results,
      totalPassed: 0,
      totalTests: request.testCases.length,
      totalExecutionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Execution failed',
    };
  }
}
