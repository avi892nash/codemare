import { auth } from '@/auth';
import { handleRunRequest } from '@/lib/server/runner';

/**
 * POST /api/submit — `{questionId, language, code, attemptId?}`: every test,
 * hidden ones included (redacted in the stream), streamed as
 * text/event-stream (lib/sse.ts RunEvent). An accepted submit earns tokens
 * and badges and gets a percentile; with `attemptId` it is a `gate`
 * submission for that attempt.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  return handleRunRequest(request, 'submit', session?.user?.id);
}
