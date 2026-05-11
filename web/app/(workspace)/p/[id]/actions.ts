'use server';

import { compile, CompileServiceError } from '@/lib/compile';
import type { ExecutionRequest, ExecutionResponse } from '@/lib/types';

/**
 * Server action: run a problem-mode submission. Called from the editor
 * client component; the INTERNAL_TOKEN is attached server-side so the browser
 * never sees it.
 *
 * Returns the full ExecutionResponse so the client can render the verdict
 * banner + metric strip + per-test breakdown without an extra round trip.
 */
export async function runSolution(req: ExecutionRequest): Promise<ExecutionResponse> {
  try {
    return await compile.execute(req);
  } catch (err) {
    const message =
      err instanceof CompileServiceError
        ? `compile service ${err.status}`
        : err instanceof Error
          ? err.message
          : 'compile service unreachable';
    return {
      success: false,
      testResults: [],
      totalPassed: 0,
      totalTests: 0,
      executionTime: 0,
      memoryUsed: 0,
      status: 'XX',
      error: message,
    };
  }
}
