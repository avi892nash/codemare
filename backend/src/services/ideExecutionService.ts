import { executeSandboxed } from './sandboxService.js';
import {
  IdeExecutionRequest,
  IdeExecutionResponse,
  IdeTestResult,
} from '../models/IdeExecution.js';

/**
 * Execute code against custom test cases (stdin/stdout mode).
 *
 * Test cases are independent — same code, different stdin — so they run
 * concurrently. The sandbox's BoxPool bounds real parallelism, and (for
 * C++/Java) the compile cache means the first case to reach the compiler
 * populates it via single-flight while the rest wait on that one compile
 * rather than each compiling their own copy. Net effect for N cases of a
 * compiled language: 1 compile + N parallel runs, instead of N sequential
 * (compile + run).
 */
export async function executeIdeCode(
  request: IdeExecutionRequest
): Promise<IdeExecutionResponse> {
  const startTime = Date.now();

  try {
    // Each callback always resolves to an IdeTestResult (never throws) so
    // Promise.all returns every case's result, in order, even on failure.
    const results: IdeTestResult[] = await Promise.all(
      request.testCases.map(async (testCase): Promise<IdeTestResult> => {
        try {
          const sandbox = await executeSandboxed(
            request.language,
            request.code,
            testCase.input
          );

          const actualOutput = sandbox.output || '';
          const normalizedActual = actualOutput.trimEnd();
          const normalizedExpected = testCase.expectedOutput.trimEnd();
          const passed =
            sandbox.status === 'OK' && normalizedActual === normalizedExpected;

          return {
            input: testCase.input,
            expectedOutput: testCase.expectedOutput,
            actualOutput,
            passed,
            // Service-side wall is meaningless under parallelism; use the
            // sandbox's per-process wall for an honest per-case number.
            executionTime: sandbox.wallMs,
            runMs: sandbox.runMs,
            wallMs: sandbox.wallMs,
            memoryKb: sandbox.memoryKb,
            compileMs: sandbox.compileMs,
            status: sandbox.status,
            error: sandbox.error,
          };
        } catch (error) {
          return {
            input: testCase.input,
            expectedOutput: testCase.expectedOutput,
            actualOutput: '',
            passed: false,
            executionTime: 0,
            error: error instanceof Error ? error.message : 'Execution failed',
          };
        }
      })
    );

    const totalPassed = results.filter((r) => r.passed).length;

    return {
      success: totalPassed === results.length,
      testResults: results,
      totalPassed,
      totalTests: results.length,
      totalExecutionTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      testResults: [],
      totalPassed: 0,
      totalTests: request.testCases.length,
      totalExecutionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Execution failed',
    };
  }
}
