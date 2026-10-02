import { describe, expect, it } from 'vitest';
import { STAT_FOR_CRITERIA, criteriaMet, longestStreak, utcDay, type BadgeStats } from './badges';
import { gradeCheckpoint, isCheckpointAnswerCorrect } from './checkpoints';
import { isValidHandle, normalizeHandle, withSuffix } from './handles';
import { hasRole, isRole } from './roles';
import { normalizeVerdict, sanitizeTestOutcome, summarizeOutcomes } from './testResults';

describe('badge criteria', () => {
  const stats: BadgeStats = {
    solveCount: 3,
    solvesByDifficulty: { Easy: 2, Medium: 1, Hard: 0 },
    longestStreak: 4,
    noHintSolves: 2,
    topicsUnlocked: 2,
    openTierOrds: [0, 1],
    gateFirstTry: true,
    lessonsCompleted: 5,
    tracksCompleted: 0,
    bestPercentile: 91.5,
  };

  it('evaluates every criteria kind', () => {
    expect(criteriaMet({ kind: 'first_accept' }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'solves', n: 3 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'solves', n: 4 }, stats)).toBe(false);
    expect(criteriaMet({ kind: 'solves_difficulty', difficulty: 'Medium', n: 1 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'solves_difficulty', difficulty: 'Hard', n: 1 }, stats)).toBe(false);
    expect(criteriaMet({ kind: 'streak_days', n: 4 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'streak_days', n: 5 }, stats)).toBe(false);
    expect(criteriaMet({ kind: 'no_hint_solves', n: 2 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'topics_unlocked', n: 2 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'tier_open', tier_ord: 1 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'tier_open', tier_ord: 2 }, stats)).toBe(false);
    expect(criteriaMet({ kind: 'gate_first_try' }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'lessons_completed', n: 5 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'track_completed' }, stats)).toBe(false);
    expect(criteriaMet({ kind: 'fast_solve', percentile: 90 }, stats)).toBe(true);
    expect(criteriaMet({ kind: 'fast_solve', percentile: 95 }, stats)).toBe(false);
    expect(criteriaMet({ kind: 'fast_solve', percentile: 0 }, { bestPercentile: null })).toBe(false);
    expect(criteriaMet({ kind: 'first_accept' }, { solveCount: 0 })).toBe(false);
  });

  it('maps every kind to a stat and refuses to guess a missing one', () => {
    expect(Object.keys(STAT_FOR_CRITERIA)).toHaveLength(11);
    expect(() => criteriaMet({ kind: 'solves', n: 1 }, {})).toThrow(/solveCount/);
  });
});

describe('streaks', () => {
  it('finds the longest run of consecutive UTC days', () => {
    expect(longestStreak([])).toBe(0);
    expect(longestStreak(['2026-03-01'])).toBe(1);
    expect(longestStreak(['2026-03-03', '2026-03-01', '2026-03-02', '2026-03-02'])).toBe(3);
    expect(longestStreak(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-05', '2026-03-06'])).toBe(3);
    expect(longestStreak(['2025-12-31', '2026-01-01'])).toBe(2);
  });

  it('buckets by UTC day', () => {
    expect(utcDay(new Date('2026-03-01T23:59:59Z'))).toBe('2026-03-01');
    expect(utcDay(new Date('2026-03-02T00:30:00+05:30'))).toBe('2026-03-01');
  });
});

describe('test results', () => {
  it('hides input/expected/actual of hidden tests', () => {
    expect(
      sanitizeTestOutcome({ idx: 3, passed: false, hidden: true, runtimeUs: 12.4, memoryKb: 900, input: [1], expected: 2, actual: 3, error: 'boom', explainOnFail: 'why' })
    ).toEqual({ idx: 3, passed: false, hidden: true, runtimeUs: 12, memoryKb: 900, error: 'boom', explainOnFail: 'why' });
  });

  it('keeps explain_on_fail only for failed tests', () => {
    expect(sanitizeTestOutcome({ idx: 0, passed: true, hidden: false, input: [1], expected: 1, actual: 1, explainOnFail: 'x' })).toEqual({
      idx: 0,
      passed: true,
      hidden: false,
      runtimeUs: null,
      memoryKb: null,
      input: [1],
      expected: 1,
      actual: 1,
    });
  });

  it('keeps a visible null actual (a function may return null)', () => {
    expect(sanitizeTestOutcome({ idx: 0, passed: false, hidden: false, input: [], expected: 1, actual: null })).toHaveProperty('actual', null);
  });

  it('totals: runtime = Σ CPU µs, memory = max', () => {
    expect(
      summarizeOutcomes([
        { idx: 0, passed: true, hidden: false, runtimeUs: 10, memoryKb: 100 },
        { idx: 1, passed: false, hidden: true, runtimeUs: 15, memoryKb: 300 },
        { idx: 2, passed: true, hidden: true, runtimeUs: null, memoryKb: 200 },
      ])
    ).toEqual({ totalPassed: 2, totalTests: 3, runtimeUs: 25, memoryKb: 300 });
    expect(summarizeOutcomes([])).toEqual({ totalPassed: 0, totalTests: 0, runtimeUs: null, memoryKb: null });
  });

  it('never records OK unless every test passed', () => {
    expect(normalizeVerdict('OK', 3, 3)).toBe('OK');
    expect(normalizeVerdict('OK', 2, 3)).toBe('WA');
    expect(normalizeVerdict('OK', 0, 0)).toBe('WA');
    expect(normalizeVerdict('TLE', 2, 3)).toBe('TLE');
  });
});

describe('handles', () => {
  it('normalizes free text into a valid handle', () => {
    expect(normalizeHandle('Ada Lovelace')).toBe('ada_lovelace');
    expect(normalizeHandle('octo-cat')).toBe('octo_cat');
    expect(normalizeHandle('José.Ñúñez')).toBe('jose_nunez');
    expect(normalizeHandle('__x__')).toBeNull();
    expect(normalizeHandle('ab')).toBeNull();
    expect(normalizeHandle('a'.repeat(40))).toHaveLength(24);
    expect(normalizeHandle(null)).toBeNull();
  });

  it('fits suffixes within 24 chars', () => {
    expect(withSuffix('abc', 42)).toBe('abc42');
    expect(withSuffix('x'.repeat(24), 123)).toBe(`${'x'.repeat(21)}123`);
    expect(isValidHandle(withSuffix('x'.repeat(24), 123))).toBe(true);
    expect(isValidHandle('Upper')).toBe(false);
  });
});

describe('roles', () => {
  it('orders learner < author < staff < admin', () => {
    expect(hasRole('admin', 'staff')).toBe(true);
    expect(hasRole('staff', 'staff')).toBe(true);
    expect(hasRole('author', 'staff')).toBe(false);
    expect(hasRole(undefined, 'learner')).toBe(true);
    expect(hasRole(null, 'author')).toBe(false);
    expect(isRole('staff')).toBe(true);
    expect(isRole('root')).toBe(false);
  });
});

describe('checkpoints', () => {
  const qs = [
    { id: 'm', kind: 'mcq' as const, answer: 2 },
    { id: 's', kind: 'short' as const, answer: ['O(n log n)', 'n log n'] },
    { id: 't', kind: 'short' as const, answer: 'Stack' },
  ];

  it('grades mcq by index and short answers loosely', () => {
    expect(isCheckpointAnswerCorrect(qs[0], 2)).toBe(true);
    expect(isCheckpointAnswerCorrect(qs[0], '2')).toBe(true);
    expect(isCheckpointAnswerCorrect(qs[0], 1)).toBe(false);
    expect(isCheckpointAnswerCorrect(qs[1], '  n  LOG n ')).toBe(true);
    expect(isCheckpointAnswerCorrect(qs[2], 'stack')).toBe(true);
    expect(isCheckpointAnswerCorrect(qs[2], 2)).toBe(false);
  });

  it('passes at the pass ratio', () => {
    expect(gradeCheckpoint(qs, { m: 2, s: 'n log n', t: 'queue' })).toEqual({
      score: 2,
      total: 3,
      passed: false,
      results: { m: true, s: true, t: false },
    });
    expect(gradeCheckpoint(qs, { m: 2, s: 'n log n', t: 'queue' }, 0.6).passed).toBe(true);
    expect(gradeCheckpoint([], {}).passed).toBe(false);
  });
});
