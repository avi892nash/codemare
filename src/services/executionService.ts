import { executeInDocker } from './dockerService.js';
import { wrapFunctionCode } from './codeWrapperService.js';
import { validateResults } from './validationService.js';
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
      request.language
    );

    // Execute wrapped code with generic executor
    const dockerOutput = await executeInDocker(
      request.language,
      wrappedCode,
      input
    );

    // Check for Docker execution errors
    if (dockerOutput.error) {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: problem.testCases.length,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
        error: dockerOutput.error,
      };
    }

    // Parse results from wrapped code output
    let parsedResults;
    try {
      parsedResults = JSON.parse(dockerOutput.output);
    } catch (parseError) {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: problem.testCases.length,
        executionTime: Date.now() - startTime,
        memoryUsed: 0,
        error: 'Failed to parse test results',
      };
    }

    // Validate results
    const testResults = validateResults(
      parsedResults.results || [],
      problem.testCases
    );

    const totalPassed = testResults.filter((r) => r.passed).length;
    const totalTests = testResults.length;

    return {
      success: totalPassed === totalTests,
      testResults,
      totalPassed,
      totalTests,
      executionTime: Date.now() - startTime,
      memoryUsed: 0, // TODO: Get actual memory usage from Docker stats
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
