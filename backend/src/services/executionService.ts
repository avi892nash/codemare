import { executeSandboxed } from './sandboxService.js';
import { wrapFunctionCode } from './codeWrapperService.js';
import { deriveVerdict, validateResults } from './validationService.js';
import {
  ExecutionRequest,
  ExecutionResponse,
  Language,
} from '../models/ExecutionResult.js';
import { Problem } from '../models/Problem.js';

/**
 * Execute user code against problem test cases
 */
export async function executeCode(
  request: ExecutionRequest,
  problem: Problem
): Promise<ExecutionResponse> {
  const startTime = Date.now();

  try {
    // Validate code size
    if (request.code.length > 10000) {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: 0,
        executionTime: 0,
        memoryUsed: 0,
        error: 'Code size exceeds limit (10KB)',
      };
    }

    // Validate code is not empty
    if (!request.code.trim()) {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: 0,
        executionTime: 0,
        memoryUsed: 0,
        error: 'Code cannot be empty',
      };
    }

    // Wrap user's function code with test harness
    const { wrappedCode, input } = wrapFunctionCode(
      request.code,
      problem.functionName,
      problem.testCases,
      request.language,
      problem.compareMode,
      problem.signature
    );

    // Execute wrapped code through the active sandbox adapter
    const sandbox = await executeSandboxed(
      request.language,
      wrappedCode,
      input
    );

    if (sandbox.error || sandbox.status === 'CE' || sandbox.status === 'XX') {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: problem.testCases.length,
        executionTime: Date.now() - startTime,
        memoryUsed: sandbox.memoryKb * 1024,
        runMs: sandbox.runMs,
        wallMs: sandbox.wallMs,
        memoryKb: sandbox.memoryKb,
        compileMs: sandbox.compileMs,
        status: sandbox.status,
        error: sandbox.error,
      };
    }

    // Parse results from wrapped code output
    let parsedResults;
    try {
      parsedResults = JSON.parse(sandbox.output);
    } catch {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: problem.testCases.length,
        executionTime: Date.now() - startTime,
        memoryUsed: sandbox.memoryKb * 1024,
        runMs: sandbox.runMs,
        wallMs: sandbox.wallMs,
        memoryKb: sandbox.memoryKb,
        compileMs: sandbox.compileMs,
        status: sandbox.status,
        error: 'Failed to parse test results',
      };
    }

    // Validate results
    const testResults = validateResults(
      parsedResults.results || [],
      problem.testCases,
      problem.compareMode
    );

    const totalPassed = testResults.filter((r) => r.passed).length;
    const totalTests = testResults.length;

    // Prefer the wrapper-reported algorithm-only metrics. Fall back to the
    // sandbox's whole-process numbers (which include interpreter startup) only
    // if the wrapper didn't emit them — e.g. for the C++/Java stubs.
    const wrapperRunMs =
      typeof parsedResults.totalRunNs === 'number'
        ? parsedResults.totalRunNs / 1_000_000
        : undefined;
    const wrapperMemoryKb =
      typeof parsedResults.peakBytes === 'number'
        ? parsedResults.peakBytes / 1024
        : undefined;
    const runMs = wrapperRunMs ?? sandbox.runMs;
    const memoryKb = wrapperMemoryKb ?? sandbox.memoryKb;

    // The wrapper itself may declare failure via an `error` field — e.g. the
    // C++/Java stubs that report Problems mode isn't implemented yet. Surface
    // that to the response so the verdict banner shows a real message.
    const wrapperError: string | undefined =
      typeof parsedResults.error === 'string' ? parsedResults.error : undefined;

    return {
      success: totalPassed === totalTests && sandbox.status === 'OK' && !wrapperError,
      testResults,
      totalPassed,
      totalTests,
      executionTime: Date.now() - startTime,
      memoryUsed: memoryKb * 1024,
      runMs,
      wallMs: sandbox.wallMs,
      memoryKb,
      compileMs: sandbox.compileMs,
      // The sandbox says 'OK' for any clean exit — derive the real verdict
      // ('WA' when tests failed) so downstream consumers can trust the status.
      // A wrapper-declared error (e.g. the C++/Java Problems-mode stubs) is a
      // platform-side failure, not the user's code being wrong — report 'XX'.
      status: wrapperError ? 'XX' : deriveVerdict(sandbox.status, totalPassed, totalTests),
      error: wrapperError,
    };
  } catch (error) {
    return {
      success: false,
      testResults: [],
      totalPassed: 0,
      totalTests: problem.testCases.length,
      executionTime: Date.now() - startTime,
      memoryUsed: 0,
      error:
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred',
    };
  }
}

/**
 * Validate execution request
 */
export function validateExecutionRequest(
  request: ExecutionRequest
): { valid: boolean; error?: string } {
  if (!request.problemId || typeof request.problemId !== 'string') {
    return { valid: false, error: 'Invalid problemId' };
  }

  if (!request.code || typeof request.code !== 'string') {
    return { valid: false, error: 'Invalid code' };
  }

  const validLanguages: Language[] = ['python', 'javascript', 'cpp', 'java'];
  if (!validLanguages.includes(request.language)) {
    return { valid: false, error: 'Invalid language' };
  }

  return { valid: true };
}
