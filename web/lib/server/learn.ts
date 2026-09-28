import 'server-only';
import { prisma } from './db';
import { evaluateBadges, type AwardedBadge } from './badges';
import { NotFoundError } from './errors';
import { gradeCheckpoint, type CheckpointGrade } from './rules/checkpoints';

/**
 * Learn + library progress. Completing a lesson and passing a checkpoint
 * evaluate badges (spec §3.7) and return what was awarded.
 */

/** Mark a lesson started (keeps an existing completion). */
export async function startLesson(userId: string, lessonId: string): Promise<void> {
  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, status: 'started' },
    update: {},
  });
}

/** Mark a lesson completed (idempotent) and evaluate badges. */
export async function completeLesson(userId: string, lessonId: string): Promise<{ badgesAwarded: AwardedBadge[] }> {
  const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
  if (!lesson) throw new NotFoundError('lesson', lessonId);
  const now = new Date();
  const existing = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId } },
    select: { status: true },
  });
  if (existing?.status === 'completed') return { badgesAwarded: [] };
  await prisma.lessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, status: 'completed', startedAt: now, completedAt: now },
    update: { status: 'completed', completedAt: now },
  });
  return { badgesAwarded: await evaluateBadges(userId) };
}

export interface CheckpointSubmission extends CheckpointGrade {
  attemptId: string;
  badgesAwarded: AwardedBadge[];
}

/**
 * Grade a module checkpoint (`responses`: question id → answer), store the
 * attempt, and evaluate badges when it passed.
 */
export async function submitCheckpoint(
  userId: string,
  moduleId: string,
  responses: Record<string, unknown>
): Promise<CheckpointSubmission> {
  const questions = await prisma.checkpointQuestion.findMany({
    where: { moduleId },
    orderBy: { ord: 'asc' },
    select: { id: true, kind: true, answer: true },
  });
  if (questions.length === 0) throw new NotFoundError('checkpoint', moduleId);
  const grade = gradeCheckpoint(
    questions.map((q) => ({ id: q.id, kind: q.kind, answer: q.answer as number | string | string[] })),
    responses
  );
  const attempt = await prisma.checkpointAttempt.create({
    data: {
      userId,
      moduleId,
      score: grade.score,
      total: grade.total,
      passed: grade.passed,
      answers: JSON.parse(JSON.stringify(responses ?? {})),
    },
    select: { id: true },
  });
  const badgesAwarded = grade.passed ? await evaluateBadges(userId) : [];
  return { ...grade, attemptId: attempt.id, badgesAwarded };
}

/** Record that the user read a library article (first read time is kept). */
export async function markArticleRead(userId: string, articleId: string): Promise<void> {
  await prisma.libraryProgress.upsert({
    where: { userId_articleId: { userId, articleId } },
    create: { userId, articleId },
    update: {},
  });
}
