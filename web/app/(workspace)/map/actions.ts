'use server';

import { auth } from '@/auth';
import type { BadgeView } from '@/components/Loop/awards';
import { unlockTopic } from '@/lib/server/access';
import type { AwardedBadge } from '@/lib/server/badges';
import { isDomainError, type Shortfall } from '@/lib/server/errors';
import { finishGate, startGate } from '@/lib/server/gates';
import type { Difficulty } from '@/lib/types';

/**
 * The map's server actions: spend a recipe, start a gate, finish an
 * attempt. Each re-reads the session (a user id never comes from the
 * client) and calls the domain layer; expected failures come back as the
 * DomainError's JSON so the UI can say exactly what went wrong (e.g. the
 * shortfall per token topic).
 */

export interface ActionError {
  error: string;
  message: string;
  /** insufficient_tokens */
  shortfalls?: Shortfall[];
  /** gate_not_eligible */
  reason?: string;
  nextEligibleAt?: string | null;
}

type Fail = { ok: false; error: ActionError };

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const badId: Fail = { ok: false, error: { error: 'invalid_input', message: 'That link is broken — reload the map.' } };
const signedOut: Fail = { ok: false, error: { error: 'unauthorized', message: 'Your session ended. Sign in again.' } };

async function viewerId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

function failure(e: unknown): Fail {
  if (isDomainError(e)) return { ok: false, error: e.toJSON() as unknown as ActionError };
  console.error('[map actions]', e);
  return { ok: false, error: { error: 'internal', message: 'Something went wrong. Try again.' } };
}

const badgeViews = (list: AwardedBadge[]): BadgeView[] => list.map(({ slug, name, description }) => ({ slug, name, description }));

export type UnlockActionResult =
  | {
      ok: true;
      status: 'unlocked' | 'already_unlocked';
      /** What was debited: tokens per (topic, difficulty) bucket. */
      spent: { topicId: string; difficulty: Difficulty; amount: number }[];
      badges: BadgeView[];
    }
  | Fail;

/** Spend `recipeId` to unlock `topicId` (spec §3.3–3.4). */
export async function unlockTopicAction(topicId: string, recipeId: string): Promise<UnlockActionResult> {
  const userId = await viewerId();
  if (!userId) return signedOut;
  if (!ID.test(String(topicId)) || !ID.test(String(recipeId))) return badId;
  try {
    const r = await unlockTopic(userId, topicId, recipeId);
    return { ok: true, status: r.status, spent: r.debits, badges: badgeViews(r.badgesAwarded) };
  } catch (e) {
    return failure(e);
  }
}

export type StartGateResult = { ok: true; attemptId: string; deadlineAt: string } | Fail;

/** Start an attempt at a gate (spec §3.5). */
export async function startGateAction(gateId: string): Promise<StartGateResult> {
  const userId = await viewerId();
  if (!userId) return signedOut;
  if (!ID.test(String(gateId))) return badId;
  try {
    const attempt = await startGate(userId, gateId);
    return { ok: true, attemptId: attempt.id, deadlineAt: attempt.deadlineAt.toISOString() };
  } catch (e) {
    return failure(e);
  }
}

export type FinishGateResult =
  | {
      ok: true;
      passed: boolean;
      passedCount: number;
      passThreshold: number;
      tierUnlocked: boolean;
      nextEligibleAt: string | null;
      badges: BadgeView[];
    }
  | Fail;

/** Finish an attempt now (or at its deadline if that has passed). Idempotent. */
export async function finishGateAction(attemptId: string): Promise<FinishGateResult> {
  const userId = await viewerId();
  if (!userId) return signedOut;
  if (!ID.test(String(attemptId))) return badId;
  try {
    const r = await finishGate(userId, attemptId);
    return {
      ok: true,
      passed: r.passed,
      passedCount: r.passedCount,
      passThreshold: r.passThreshold,
      tierUnlocked: r.tierUnlocked,
      nextEligibleAt: r.nextEligibleAt?.toISOString() ?? null,
      badges: badgeViews(r.badgesAwarded),
    };
  } catch (e) {
    return failure(e);
  }
}
