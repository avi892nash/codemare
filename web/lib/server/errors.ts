/**
 * Typed domain errors. Every service in lib/server throws one of these for
 * an expected, user-facing failure; anything else is a bug.
 *
 * Route handlers / server actions map them generically:
 *
 *   catch (e) {
 *     if (isDomainError(e)) return Response.json(e.toJSON(), { status: e.status });
 *     throw e;
 *   }
 *
 * Pure module (no DB, no server-only) so client code can share the types.
 */
import type { Difficulty, HintLevel } from '@/lib/types';

export abstract class DomainError extends Error {
  /** Stable machine code, e.g. `insufficient_tokens`. */
  abstract readonly code: string;
  /** Suggested HTTP status. */
  abstract readonly status: number;

  /** JSON body for an API response: `{ error: code, message, ...details }`. */
  toJSON(): Record<string, unknown> {
    return { error: this.code, message: this.message };
  }
}

export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError;
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
  readonly status = 404;
  constructor(
    readonly entity: string,
    readonly id: string
  ) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export type AccessDeniedReason = 'topic_locked' | 'draft' | 'gate_attempt_closed' | 'forbidden';

export class AccessDenied extends DomainError {
  readonly code = 'access_denied';
  readonly status = 403;
  constructor(
    readonly reason: AccessDeniedReason,
    message = 'You do not have access to this yet.'
  ) {
    super(message);
    this.name = 'AccessDenied';
  }
  toJSON() {
    return { ...super.toJSON(), reason: this.reason };
  }
}

export interface Shortfall {
  topicId: string;
  minDifficulty: Difficulty;
  /** Tokens the requirement needs. */
  need: number;
  /** Qualifying tokens that were available to it. */
  have: number;
}

/** A spend could not be covered. Nothing was written. */
export class InsufficientTokens extends DomainError {
  readonly code = 'insufficient_tokens';
  readonly status = 409;
  constructor(readonly shortfalls: Shortfall[]) {
    super(
      'Not enough tokens: ' +
        shortfalls
          .map((s) => `${s.topicId} needs ${s.need} (${s.minDifficulty}+), has ${s.have}`)
          .join('; ')
    );
    this.name = 'InsufficientTokens';
  }
  toJSON() {
    return { ...super.toJSON(), shortfalls: this.shortfalls };
  }
}

/** The topic's tier is not open yet — pass its gate first. */
export class TierLocked extends DomainError {
  readonly code = 'tier_locked';
  readonly status = 409;
  constructor(readonly tierId: string) {
    super('This tier is closed. Pass its gate first.');
    this.name = 'TierLocked';
  }
  toJSON() {
    return { ...super.toJSON(), tierId: this.tierId };
  }
}

/** A dependency has no passing version in the requested language (spec §4: HTTP 409). */
export class MissingDependencies extends DomainError {
  readonly code = 'missing_dependencies';
  readonly status = 409;
  constructor(
    /** Component slugs, in build order. */
    readonly missing: string[]
  ) {
    super(`Build these first: ${missing.join(', ')}`);
    this.name = 'MissingDependencies';
  }
  toJSON() {
    return { ...super.toJSON(), missing: this.missing };
  }
}

/** The component dependency graph has a cycle (bad content). */
export class DependencyCycle extends DomainError {
  readonly code = 'dependency_cycle';
  readonly status = 500;
  constructor(readonly cycle: string[]) {
    super(`Component dependency cycle: ${cycle.join(' → ')}`);
    this.name = 'DependencyCycle';
  }
  toJSON() {
    return { ...super.toJSON(), cycle: this.cycle };
  }
}

/** Lower hint levels must be revealed first. */
export class HintLocked extends DomainError {
  readonly code = 'hint_locked';
  readonly status = 409;
  constructor(readonly missingLevels: HintLevel[]) {
    super(`Reveal ${missingLevels.join(', ')} first.`);
    this.name = 'HintLocked';
  }
  toJSON() {
    return { ...super.toJSON(), missingLevels: this.missingLevels };
  }
}

export type GateIneligibleReason = 'already_open' | 'previous_tier_closed' | 'running' | 'cooldown';

export class GateNotEligible extends DomainError {
  readonly code = 'gate_not_eligible';
  readonly status = 409;
  constructor(
    readonly reason: GateIneligibleReason,
    readonly nextEligibleAt: Date | null = null
  ) {
    super(
      {
        already_open: 'This tier is already open.',
        previous_tier_closed: 'Open the previous tier first.',
        running: 'You already have a running attempt for this gate.',
        cooldown: 'This gate is cooling down.',
      }[reason]
    );
    this.name = 'GateNotEligible';
  }
  toJSON() {
    return {
      ...super.toJSON(),
      reason: this.reason,
      nextEligibleAt: this.nextEligibleAt?.toISOString() ?? null,
    };
  }
}

/** Bad input that validation upstream should have caught. */
export class InvalidInput extends DomainError {
  readonly code = 'invalid_input';
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInput';
  }
}
