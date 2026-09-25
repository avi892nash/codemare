'use server';

import { compile, CompileServiceError } from '@/lib/compile';
import { auth } from '@/auth';
import { consume, retryMessage, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import type { IdeExecutionRequest, IdeExecutionResponse } from '@/lib/types';

export async function runIdeCode(req: IdeExecutionRequest): Promise<IdeExecutionResponse> {
  const session = await auth();
  if (session?.user?.id) {
    const rl = consume(`submit:${session.user.id}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
    if (!rl.ok) {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: 0,
        totalExecutionTime: 0,
        error: retryMessage(rl.retryAfterSec),
      };
    }
  }

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
