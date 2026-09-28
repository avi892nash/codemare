'use server';

import { compile, CompileServiceError } from '@/lib/compile';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { consume, retryMessage, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import type { ExecutionRequest, ExecutionResponse } from '@/lib/types';

/**
 * Run a problem-mode submission. Two side effects:
 *
 *   1. Calls the compile service with the internal token (server-side; the
 *      browser never sees it).
 *   2. If a signed-in user is in session AND the database is reachable, the
 *      submission is persisted to the `Submission` table. Missing DB / no
 *      user / errors during persistence are swallowed silently so dev keeps
 *      working — the run itself is the authoritative response either way.
 *
 * The Question row is upserted by slug (as a `draft` stub when the seed has
 * not provided it) so we can persist a submission even when the problem
 * catalog still lives in the compile service (transitional; this page is
 * replaced by /problems/[slug] + /api/submit).
 */
export async function runSolution(req: ExecutionRequest): Promise<ExecutionResponse> {
  const session = await auth();

  if (session?.user?.id) {
    const rl = consume(`submit:${session.user.id}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
    if (!rl.ok) {
      return {
        success: false,
        testResults: [],
        totalPassed: 0,
        totalTests: 0,
        executionTime: 0,
        memoryUsed: 0,
        status: 'XX',
        error: retryMessage(rl.retryAfterSec),
      };
    }
  }

  let response: ExecutionResponse;
  try {
    response = await compile.execute(req);
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

  // Persist if we can. Best-effort.
  try {
    if (session?.user?.id) {
      const question = await prisma.question.upsert({
        where: { slug: req.problemId },
        create: {
          slug: req.problemId,
          title: req.problemId, // backfilled by the seed (upsert by slug)
          difficulty: 'Easy',
          statementMd: '',
          examples: [],
          constraints: [],
          functionName: '',
          signature: {},
          starterCode: {},
          tests: [],
          referenceSolutions: {},
          status: 'draft',
        },
        update: {},
        select: { id: true },
      });

      // Defense-in-depth: the compile service has been observed reporting
      // status 'OK' for runs whose tests actually failed (backend fix owned
      // elsewhere). Never persist 'OK' unless the run really passed; real
      // failure statuses (TLE/RE/CE/…) pass through untouched.
      let status = (response.status ?? (response.success ? 'OK' : 'WA')) as
        | 'OK'
        | 'WA'
        | 'TLE'
        | 'MLE'
        | 'RE'
        | 'CE'
        | 'XX';
      const failed =
        response.success === false || response.totalPassed < response.totalTests;
      if (status === 'OK' && failed) status = 'WA';

      await prisma.submission.create({
        data: {
          userId: session.user.id,
          kind: 'submit',
          questionId: question.id,
          language: req.language,
          code: req.code,
          status,
          totalPassed: response.totalPassed,
          totalTests: response.totalTests,
          runtimeUs: response.runMs == null ? null : BigInt(Math.round(response.runMs * 1000)),
          memoryKb: response.memoryKb == null ? null : Math.round(response.memoryKb),
          compileMs: response.compileMs == null ? null : Math.round(response.compileMs),
          error: response.error ?? null,
        },
      });
    }
  } catch (persistErr) {
    // Don't fail the run if persistence fails. Log to server console only.
    console.warn('[runSolution] submission persist failed:', persistErr);
  }

  return response;
}
