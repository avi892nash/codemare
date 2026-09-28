'use server';

import { Prisma } from '@prisma/client';
import { auth } from '@/auth';
import { isDomainError } from '@/lib/server/errors';
import { markStepSeen, submitPrediction } from '@/lib/server/steps';

/**
 * Queue server actions (T2a). Each re-reads the session; the step's access
 * check, grading and progress live in the domain layer (lib/server/steps).
 */

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_ANSWER = 500;

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/** Record that the learner opened a step (never downgrades progress). */
export async function markStepSeenAction(stepId: string): Promise<void> {
  const userId = await viewerId();
  if (!userId || !ID.test(String(stepId))) return;
  try {
    await markStepSeen(userId, stepId);
  } catch (e) {
    // Two tabs racing on the first visit both insert; the row exists either way.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
    if (isDomainError(e)) return;
    throw e;
  }
}

export type PredictActionResult =
  | { ok: true; correct: boolean; expected: string; explanationMd: string }
  | { ok: false; message: string };

/** Answer a predict step; reveals the expected answer and the explanation. */
export async function submitPredictionAction(stepId: string, answer: string): Promise<PredictActionResult> {
  const userId = await viewerId();
  if (!userId) return { ok: false, message: 'Your session ended. Sign in again.' };
  if (!ID.test(String(stepId))) return { ok: false, message: 'That step link is broken — reload the queue.' };
  // Sent as given: multiple choice compares exactly, free text is normalized by the domain.
  const text = typeof answer === 'string' ? answer : '';
  if (!text.trim()) return { ok: false, message: 'Pick or type an answer first.' };
  if (text.length > MAX_ANSWER) return { ok: false, message: `Keep the answer under ${MAX_ANSWER} characters.` };
  try {
    const r = await submitPrediction(userId, stepId, text);
    return { ok: true, correct: r.correct, expected: r.expected, explanationMd: r.explanationMd };
  } catch (e) {
    if (isDomainError(e)) return { ok: false, message: e.message };
    console.error('[queue actions]', e);
    return { ok: false, message: 'Something went wrong. Try again.' };
  }
}
