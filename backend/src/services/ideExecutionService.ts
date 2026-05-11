import { executeSandboxed } from './sandboxService.js';
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
        // Execute code through the active sandbox adapter (no wrapper for IDE mode)
        const sandbox = await executeSandboxed(
          request.language,
          request.code,
          testCase.input
        );

        const wallMs = Date.now() - testStartTime;
        const actualOutput = sandbox.output || '';

        const normalizedActual = actualOutput.trimEnd();
        const normalizedExpected = testCase.expectedOutput.trimEnd();
        const passed =
          sandbox.status === 'OK' && normalizedActual === normalizedExpected;

        results.push({
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          actualOutput: actualOutput,
          passed: passed,
          executionTime: wallMs,
          runMs: sandbox.runMs,
          wallMs: sandbox.wallMs,
          memoryKb: sandbox.memoryKb,
          compileMs: sandbox.compileMs,
          status: sandbox.status,
          error: sandbox.error,
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
