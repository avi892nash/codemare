/**
 * Pure gate rules (spec §3.5): deadline and cooldown math, eligibility,
 * pass decision.
 */
import type { GateIneligibleReason } from '../errors';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** `started_at + time_limit_minutes`. */
export function gateDeadline(startedAt: Date, timeLimitMinutes: number): Date {
  return new Date(startedAt.getTime() + timeLimitMinutes * MINUTE_MS);
}

/** A failed attempt's `next_eligible_at` = `finished_at + cooldown_hours`. */
export function cooldownEnd(finishedAt: Date, cooldownHours: number): Date {
  return new Date(finishedAt.getTime() + cooldownHours * HOUR_MS);
}

/** An unfinished attempt past its deadline must be finished (lazily). */
export function isAttemptExpired(
  attempt: { deadlineAt: Date; finishedAt: Date | null },
  now: Date
): boolean {
  return attempt.finishedAt === null && now.getTime() >= attempt.deadlineAt.getTime();
}

/** An attempt is running while unfinished and before its deadline. */
export function isAttemptRunning(
  attempt: { deadlineAt: Date; finishedAt: Date | null },
  now: Date
): boolean {
  return attempt.finishedAt === null && now.getTime() < attempt.deadlineAt.getTime();
}

/** `passed = passed_count ≥ pass_threshold`. */
export function isGatePassed(passedCount: number, passThreshold: number): boolean {
  return passedCount >= passThreshold;
}

export type GateEligibility =
  | { eligible: true }
  | { eligible: false; reason: GateIneligibleReason; nextEligibleAt: Date | null };

/**
 * Eligible for tier N's gate: tier N−1 open, no running attempt, and
 * `now ≥ next_eligible_at` of the latest failed attempt. A tier that is
 * already open has nothing left to pass.
 */
export function gateEligibility(input: {
  tierOpen: boolean;
  previousTierOpen: boolean;
  hasRunningAttempt: boolean;
  /** `next_eligible_at` of the latest finished attempt, if it failed. */
  cooldownUntil: Date | null;
  now: Date;
}): GateEligibility {
  if (input.tierOpen) return { eligible: false, reason: 'already_open', nextEligibleAt: null };
  if (!input.previousTierOpen) {
    return { eligible: false, reason: 'previous_tier_closed', nextEligibleAt: null };
  }
  if (input.hasRunningAttempt) return { eligible: false, reason: 'running', nextEligibleAt: null };
  if (input.cooldownUntil && input.now.getTime() < input.cooldownUntil.getTime()) {
    return { eligible: false, reason: 'cooldown', nextEligibleAt: input.cooldownUntil };
  }
  return { eligible: true };
}
