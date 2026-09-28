import 'server-only';
import type { PredictPayload } from '@/lib/types';
import { prisma } from './db';
import { assertCanAccessBuildStep } from './access';
import { InvalidInput, NotFoundError } from './errors';
import { parseJsonColumn, predictPayloadSchema } from './schemas';

/**
 * Build-step progress (app.step_progress) for the /queue: seen → predicted
 * (predict steps) or passed (build steps, via onBuildPassed).
 */

export interface PredictionResult {
  correct: boolean;
  /** The expected answer, revealed after predicting. */
  expected: string;
  explanationMd: string;
}

/** Record that the user opened a step (never downgrades later progress). */
export async function markStepSeen(userId: string, buildStepId: string): Promise<void> {
  await assertCanAccessBuildStep(userId, buildStepId);
  await prisma.stepProgress.upsert({
    where: { userId_buildStepId: { userId, buildStepId } },
    create: { userId, buildStepId, status: 'seen' },
    update: {},
  });
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Answer a predict step: multiple choice compares exactly, free text
 * compares trimmed and case-insensitively. Stores status `predicted` with
 * the answer and correctness (re-answering overwrites).
 */
export async function submitPrediction(userId: string, buildStepId: string, answer: string): Promise<PredictionResult> {
  await assertCanAccessBuildStep(userId, buildStepId);
  const step = await prisma.buildStep.findUnique({
    where: { id: buildStepId },
    select: { kind: true, payload: true },
  });
  if (!step) throw new NotFoundError('build step', buildStepId);
  if (step.kind !== 'predict') throw new InvalidInput('not a predict step');
  const payload: PredictPayload = parseJsonColumn(predictPayloadSchema, step.payload, `build_steps.payload (${buildStepId})`);

  const correct = payload.choices ? answer === payload.answer : normalize(answer) === normalize(payload.answer);
  await prisma.stepProgress.upsert({
    where: { userId_buildStepId: { userId, buildStepId } },
    create: { userId, buildStepId, status: 'predicted', answer, correct },
    update: { status: 'predicted', answer, correct },
  });
  return { correct, expected: payload.answer, explanationMd: payload.explanation_md };
}
