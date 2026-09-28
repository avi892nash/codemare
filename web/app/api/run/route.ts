import { auth } from '@/auth';
import { handleRunRequest } from '@/lib/server/runner';

/**
 * POST /api/run — `{questionId, language, code, customInputs?, attemptId?}`:
 * the question's visible tests plus learner-added inputs (expected values
 * from the reference solution), streamed as text/event-stream (lib/sse.ts
 * RunEvent). Persisted as a `run` submission; earns nothing.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  return handleRunRequest(request, 'run', session?.user?.id);
}
