'use server';

import { compile, CompileServiceError } from '@/lib/compile';
import type { IdeExecutionRequest, IdeExecutionResponse } from '@/lib/types';

export async function runIdeCode(req: IdeExecutionRequest): Promise<IdeExecutionResponse> {
  try {
    return await compile.executeIde(req);
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
      totalExecutionTime: 0,
      error: message,
    };
  }
}
