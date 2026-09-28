'use server';

import { Prisma } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import type { RunResult } from '@/components/ui/RunnableCodeBlock';
import { isDomainError } from '@/lib/server/errors';
import { completeLesson, startLesson, submitCheckpoint } from '@/lib/server/learn';
import { findLessonId, findModuleId } from '@/lib/server/learnViews';
import { runSnippetForUser } from '@/lib/server/snippets';
import type { BadgeRarity } from '@/lib/types';

/**
 * Learn server actions. Every one re-reads the session (never trusts a
 * user id from the client) and resolves content by slug, so a forged
 * lesson / module id cannot be passed in.
 */

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isSlug = (v: unknown): v is string => typeof v === 'string' && v.length <= 80 && SLUG.test(v);

export interface AwardedBadgeView {
  slug: string;
  name: string;
  icon: string;
  rarity: BadgeRarity;
}

const toBadgeViews = (list: { slug: string; name: string; icon: string; rarity: BadgeRarity }[]): AwardedBadgeView[] =>
  list.map(({ slug, name, icon, rarity }) => ({ slug, name, icon, rarity }));

/**
 * Run a lesson snippet (`RunnableCodeBlock`'s `run`, bound to a language
 * per block). One stdin → stdout run on the compile service, rate-limited
 * with the shared per-user submission bucket.
 */
export async function runSnippet(language: string, code: string, stdin: string): Promise<RunResult> {
  const userId = await viewerId();
  if (!userId) return { status: 'XX', error: 'Sign in to run code.' };
  return runSnippetForUser(userId, { language, code, stdin });
}

/** Record that the learner opened a lesson (keeps an existing completion). */
export async function startLessonAction(trackSlug: string, lessonSlug: string): Promise<void> {
  const userId = await viewerId();
  if (!userId || !isSlug(trackSlug) || !isSlug(lessonSlug)) return;
  const lessonId = await findLessonId(trackSlug, lessonSlug);
  if (!lessonId) return;
  try {
    await startLesson(userId, lessonId);
  } catch (e) {
    // A concurrent first visit (e.g. two tabs) races on the primary key; the row exists either way.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
  }
}

export type CompleteLessonResult = { ok: true; badges: AwardedBadgeView[] } | { ok: false; error: string };

export async function completeLessonAction(trackSlug: string, lessonSlug: string): Promise<CompleteLessonResult> {
  const userId = await viewerId();
  if (!userId) return { ok: false, error: 'Sign in to track your progress.' };
  if (!isSlug(trackSlug) || !isSlug(lessonSlug)) return { ok: false, error: 'Unknown lesson.' };
  const lessonId = await findLessonId(trackSlug, lessonSlug);
  if (!lessonId) return { ok: false, error: 'Unknown lesson.' };
  try {
    const { badgesAwarded } = await completeLesson(userId, lessonId);
    revalidatePath('/learn', 'layout');
    return { ok: true, badges: toBadgeViews(badgesAwarded) };
  } catch (e) {
    if (isDomainError(e)) return { ok: false, error: e.message };
    throw e;
  }
}

export type SubmitCheckpointResult =
  | { ok: true; attemptId: string; score: number; total: number; passed: boolean; badges: AwardedBadgeView[] }
  | { ok: false; error: string };

const MAX_ANSWER = 500;

/**
 * Grade a checkpoint. `responses` maps question id → choice index (mcq) or
 * text (short); anything else is dropped before grading.
 */
export async function submitCheckpointAction(
  trackSlug: string,
  moduleSlug: string,
  responses: Record<string, unknown>
): Promise<SubmitCheckpointResult> {
  const userId = await viewerId();
  if (!userId) return { ok: false, error: 'Sign in to take the checkpoint.' };
  if (!isSlug(trackSlug) || !isSlug(moduleSlug)) return { ok: false, error: 'Unknown checkpoint.' };
  const moduleId = await findModuleId(trackSlug, moduleSlug);
  if (!moduleId) return { ok: false, error: 'Unknown checkpoint.' };

  const clean: Record<string, number | string> = {};
  if (responses && typeof responses === 'object') {
    for (const [id, v] of Object.entries(responses).slice(0, 50)) {
      if (!/^[a-z0-9]{8,40}$/i.test(id)) continue;
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 100) clean[id] = v;
      else if (typeof v === 'string') clean[id] = v.slice(0, MAX_ANSWER);
    }
  }
  try {
    const r = await submitCheckpoint(userId, moduleId, clean);
    revalidatePath('/learn', 'layout');
    return { ok: true, attemptId: r.attemptId, score: r.score, total: r.total, passed: r.passed, badges: toBadgeViews(r.badgesAwarded) };
  } catch (e) {
    if (isDomainError(e)) return { ok: false, error: e.message };
    throw e;
  }
}
