import { auth } from '@/auth';
import { handleRunRequest } from '@/lib/server/runner';

/**
 * POST /api/build — `{buildStepId, language, code}`: a component build step
 * judged against the step's tests with the learner's latest passing version
 * of every dependency as the prelude. 409 `{error: 'missing_dependencies',
 * missing: [componentSlug]}` when one has none; otherwise the same
 * text/event-stream as /api/submit. Records a component version; a first
 * pass earns the step's tokens.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  return handleRunRequest(request, 'build', session?.user?.id);
}
