import { z } from 'zod';
import { auth } from '@/auth';
import { consume } from '@/lib/rateLimit';
import { AiReviewDisabled, aiReviewEnabled, listAiReviews, requestAiReview } from '@/lib/server/aiReview';
import { isDomainError } from '@/lib/server/errors';

/**
 * AI review of an accepted submission (spec §3.10), behind
 * FEATURE_AI_REVIEW + ANTHROPIC_API_KEY — 404 `ai_review_disabled` otherwise.
 *
 *   GET  /api/ai-review?submissionId=…            → {reviews}
 *   POST /api/ai-review {submissionId, depth?}    → {review, cached}
 *        depth "quick" (default model) | "deep" (the "Deeper review" model)
 *
 * Never part of judging: the verdict is final before this is ever called.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reviews cost money: 12 fresh ones per user per hour. */
const REVIEWS_PER_USER = { limit: 12, windowMs: 60 * 60_000 };

const idSchema = z.string().trim().min(1).max(100);
const bodySchema = z.object({ submissionId: idSchema, depth: z.enum(['quick', 'deep']).default('quick') }).strict();

function fail(e: unknown): Response {
  if (isDomainError(e)) return Response.json(e.toJSON(), { status: e.status });
  console.error('[api/ai-review]', e);
  return Response.json({ error: 'internal', message: 'Something went wrong. Try again.' }, { status: 500 });
}

export async function GET(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'unauthorized', message: 'Sign in first.' }, { status: 401 });
  if (!aiReviewEnabled()) return fail(new AiReviewDisabled());
  const id = idSchema.safeParse(new URL(request.url).searchParams.get('submissionId'));
  if (!id.success) return Response.json({ error: 'invalid_input', message: 'submissionId is required.' }, { status: 400 });
  try {
    return Response.json({ reviews: await listAiReviews(userId, id.data) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: 'unauthorized', message: 'Sign in first.' }, { status: 401 });
  if (!aiReviewEnabled()) return fail(new AiReviewDisabled());
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'invalid_input', message: 'Expected {submissionId, depth?}.' }, { status: 400 });
  const limit = consume(`ai-review:${userId}`, REVIEWS_PER_USER.limit, REVIEWS_PER_USER.windowMs);
  if (!limit.ok) {
    return Response.json(
      { error: 'rate_limited', message: `You’ve used this hour’s reviews. More in ${Math.ceil(limit.retryAfterSec / 60)} min.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }
  try {
    return Response.json(await requestAiReview(userId, body.data.submissionId, body.data.depth));
  } catch (e) {
    return fail(e);
  }
}
