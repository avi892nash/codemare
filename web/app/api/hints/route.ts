import { z } from 'zod';
import { auth } from '@/auth';
import { canAccessQuestion } from '@/lib/server/access';
import { prisma } from '@/lib/server/db';
import { AccessDenied, isDomainError } from '@/lib/server/errors';
import { getHintLadder, revealHint, type HintTarget } from '@/lib/server/hints';

/**
 * The hint ladder (spec §3.6).
 *
 *   GET  /api/hints?questionId=…  → HintLadder
 *   POST /api/hints {hintId}  → {reveal: RevealResult, ladder: HintLadder}
 *
 * The client shows each rung's cost before this is called and asks for
 * confirmation; the reveal itself enforces ladder order (409 hint_locked)
 * and spends token costs atomically (409 insufficient_tokens with the
 * shortfalls). Re-revealing is free.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().trim().min(1).max(100);

function fail(e: unknown): Response {
  if (isDomainError(e)) return Response.json(e.toJSON(), { status: e.status });
  console.error('[api/hints]', e);
  return Response.json({ error: 'internal', message: 'Something went wrong. Try again.' }, { status: 500 });
}

async function assertAccess(userId: string, target: HintTarget): Promise<void> {
  const access = await canAccessQuestion(userId, target.questionId);
  if (!access.ok) throw new AccessDenied(access.reason, 'Unlock this first to see its hints.');
}

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: 'unauthorized', message: 'Sign in to see hints.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const questionId = idSchema.safeParse(params.get('questionId'));
  if (!questionId.success) {
    return Response.json({ error: 'invalid_input', message: 'Pass a questionId.' }, { status: 400 });
  }
  const target: HintTarget = { questionId: questionId.data };
  try {
    await assertAccess(userId, target);
    return Response.json(await getHintLadder(userId, target), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return fail(e);
  }
}

const revealSchema = z.object({ hintId: idSchema }).strict();

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: 'unauthorized', message: 'Sign in to see hints.' }, { status: 401 });
  const body = revealSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: 'invalid_input', message: 'Expected {hintId}.' }, { status: 400 });
  try {
    // revealHint checks access and ladder order itself.
    const reveal = await revealHint(userId, body.data.hintId);
    const hint = await prisma.hint.findUniqueOrThrow({
      where: { id: body.data.hintId },
      select: { questionId: true },
    });
    const target: HintTarget = { questionId: hint.questionId };
    return Response.json({ reveal, ladder: await getHintLadder(userId, target) });
  } catch (e) {
    return fail(e);
  }
}
