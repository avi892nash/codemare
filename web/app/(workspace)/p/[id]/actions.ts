'use server';

import { compile, CompileServiceError } from '@/lib/compile';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
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
 * The Problem row is upserted by slug so we can persist a submission even
 * when the problem catalog still lives in the compile service (transitional;
 * the catalog moves into the DB in a later commit).
 */
export async function runSolution(req: ExecutionRequest): Promise<ExecutionResponse> {
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
    const session = await auth();
    if (session?.user?.id) {
      const problem = await prisma.problem.upsert({
        where: { slug: req.problemId },
        create: {
          slug: req.problemId,
          title: req.problemId, // backfilled when the catalog migrates into the DB
          difficulty: 'Easy',
          description: '',
          examples: [],
          constraints: [],
          starterCode: {},
          functionName: '',
          testCases: [],
          tags: [],
        },
        update: {},
        select: { id: true },
      });

      await prisma.submission.create({
        data: {
          userId: session.user.id,
          problemId: problem.id,
          language: req.language,
          code: req.code,
          status: response.status ?? (response.success ? 'OK' : 'WA' as const) as
            | 'OK'
            | 'WA'
            | 'TLE'
            | 'MLE'
            | 'RE'
            | 'CE'
            | 'XX',
          totalPassed: response.totalPassed,
          totalTests: response.totalTests,
          runMs: response.runMs ?? null,
          wallMs: response.wallMs ?? null,
          memoryKb: response.memoryKb ?? null,
          compileMs: response.compileMs ?? null,
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
