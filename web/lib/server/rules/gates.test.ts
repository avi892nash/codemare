import { describe, expect, it } from 'vitest';
import { cooldownEnd, gateDeadline, gateEligibility, isAttemptExpired, isAttemptRunning, isGatePassed } from './gates';

const t0 = new Date('2026-01-01T10:00:00Z');
const plus = (ms: number) => new Date(t0.getTime() + ms);
const H = 3_600_000;

describe('gate time math', () => {
  it('deadline = start + time limit', () => {
    expect(gateDeadline(t0, 60)).toEqual(new Date('2026-01-01T11:00:00Z'));
    expect(gateDeadline(t0, 90)).toEqual(new Date('2026-01-01T11:30:00Z'));
  });

  it('cooldown ends cooldown_hours after the finish', () => {
    expect(cooldownEnd(t0, 12)).toEqual(new Date('2026-01-01T22:00:00Z'));
    expect(cooldownEnd(t0, 24)).toEqual(new Date('2026-01-02T10:00:00Z'));
  });

  it('an attempt runs until its deadline, then is expired until finished', () => {
    const a = { deadlineAt: plus(H), finishedAt: null };
    expect(isAttemptRunning(a, t0)).toBe(true);
    expect(isAttemptExpired(a, t0)).toBe(false);
    expect(isAttemptRunning(a, plus(H))).toBe(false);
    expect(isAttemptExpired(a, plus(H))).toBe(true);
    expect(isAttemptExpired({ ...a, finishedAt: plus(H) }, plus(2 * H))).toBe(false);
  });

  it('passes at the threshold', () => {
    expect(isGatePassed(2, 2)).toBe(true);
    expect(isGatePassed(3, 2)).toBe(true);
    expect(isGatePassed(1, 2)).toBe(false);
  });
});

describe('gateEligibility', () => {
  const base = { tierOpen: false, previousTierOpen: true, hasRunningAttempt: false, cooldownUntil: null, now: t0 };

  it('is eligible with the previous tier open, nothing running, no cooldown', () => {
    expect(gateEligibility(base)).toEqual({ eligible: true });
  });

  it('needs tier N−1 open', () => {
    expect(gateEligibility({ ...base, previousTierOpen: false })).toMatchObject({
      eligible: false,
      reason: 'previous_tier_closed',
    });
  });

  it('refuses a second attempt while one runs', () => {
    expect(gateEligibility({ ...base, hasRunningAttempt: true })).toMatchObject({ eligible: false, reason: 'running' });
  });

  it('waits out the cooldown of the latest failed attempt (boundary inclusive)', () => {
    const until = plus(12 * H);
    expect(gateEligibility({ ...base, cooldownUntil: until, now: plus(12 * H - 1) })).toEqual({
      eligible: false,
      reason: 'cooldown',
      nextEligibleAt: until,
    });
    expect(gateEligibility({ ...base, cooldownUntil: until, now: until })).toEqual({ eligible: true });
  });

  it('has nothing left once the tier is open', () => {
    expect(gateEligibility({ ...base, tierOpen: true })).toMatchObject({ eligible: false, reason: 'already_open' });
  });
});
