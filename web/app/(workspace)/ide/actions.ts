'use server';

import { z } from 'zod';
import { auth } from '@/auth';
import { compile, CompileServiceError } from '@/lib/compile';
import { consume, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import { LANGUAGES, type IdeExecutionResponse } from '@/lib/types';

const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_CASES = 10;

const requestSchema = z.object({
  language: z.enum(LANGUAGES),
  code: z.string(),
  testCases: z
    .array(z.object({ input: z.string().max(64 * 1024), expectedOutput: z.string().max(64 * 1024) }))
    .min(1)
    .max(MAX_CASES),
});

export type IdeRunInput = z.infer<typeof requestSchema>;

function failure(error: string, totalTests = 0): IdeExecutionResponse {
  return { success: false, testResults: [], totalPassed: 0, totalTests, totalExecutionTime: 0, error };
}

/**
 * Run playground code against up to ten stdin cases (compile service
 * /v1/ide/execute). Signed-in only; shares the per-user judge budget with
 * /api/run · submit · build; source capped at 64 KB. Nothing is persisted.
 */
export async function runIdeCode(input: IdeRunInput): Promise<IdeExecutionResponse> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return failure('Your session has expired — sign in again.');

  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return failure('That request doesn’t look right — check the language and test cases.');
  const req = parsed.data;
  if (new TextEncoder().encode(req.code).byteLength > MAX_SOURCE_BYTES) return failure('Source code is limited to 64 KB.');
  if (!req.code.trim()) return failure('Write some code first.');

  const limit = consume(`submit:${userId}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
  if (!limit.ok) return failure(`You’re running code faster than the judge allows. Try again in ${limit.retryAfterSec} s.`);

  try {
    return await compile.executeIde(req);
  } catch (err) {
    console.error('[ide] execute failed:', err);
    return failure(
      err instanceof CompileServiceError && err.status === 400
        ? 'The judge rejected this run — check the test cases.'
        : 'The judge is unreachable right now. Try again in a moment.',
      req.testCases.length
    );
  }
}
