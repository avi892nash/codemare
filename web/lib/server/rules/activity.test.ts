import { describe, expect, it } from 'vitest';
import type { BadgeCriteria } from '@/lib/types';
import {
  acceptanceRate,
  addDays,
  badgeProgress,
  buildHeatmap,
  currentStreak,
  describeCriteria,
  heatLevel,
  type BadgeProgressStats,
} from './activity';

describe('days and streaks', () => {
  it('adds UTC days across month and year boundaries', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('counts the current streak ending today or yesterday', () => {
    const days = ['2026-09-25', '2026-09-26', '2026-09-27'];
    expect(currentStreak(days, '2026-09-27')).toBe(3);
    expect(currentStreak(days, '2026-09-28')).toBe(3); // nothing yet today: still alive
    expect(currentStreak(days, '2026-09-29')).toBe(0); // a full missed day breaks it
    expect(currentStreak([...days, '2026-09-28'], '2026-09-28')).toBe(4);
    expect(currentStreak([], '2026-09-28')).toBe(0);
  });
});

describe('buildHeatmap', () => {
  it('covers exactly the last N days, oldest first, in Sunday-first week columns', () => {
    const h = buildHeatmap(new Map([['2026-09-28', 4], ['2026-09-20', 1], ['2025-01-01', 9]]), '2026-09-28', 365);
    expect(h.days).toHaveLength(365);
    expect(h.from).toBe('2025-09-29');
    expect(h.to).toBe('2026-09-28');
    expect(h.total).toBe(5); // the 2025-01-01 count is outside the window
    expect(h.activeDays).toBe(2);
    expect(h.max).toBe(4);
    for (const w of h.weeks) expect(w).toHaveLength(7);
    // padding before the first day aligns it to its weekday row
    const first = h.weeks[0].findIndex((d) => d !== null);
    expect(first).toBe(h.days[0].weekday);
    expect(h.weeks.flat().filter(Boolean)).toHaveLength(365);
    expect(h.days.at(-1)).toMatchObject({ day: '2026-09-28', count: 4, level: 4, weekday: 1 });
  });

  it('scales levels to the busiest day', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(8, 10)).toBe(4);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
  });
});

describe('acceptanceRate', () => {
  it('is a whole percent of judged submissions, null when none', () => {
    expect(acceptanceRate(3, 4)).toBe(75);
    expect(acceptanceRate(1, 3)).toBe(33);
    expect(acceptanceRate(0, 0)).toBeNull();
    expect(acceptanceRate(5, 4)).toBe(100);
  });
});

describe('badgeProgress', () => {
  const stats: BadgeProgressStats = {
    solveCount: 7,
    solvesByDifficulty: { Easy: 5, Medium: 2, Hard: 0 },
    longestStreak: 2,
    noHintSolves: 4,
    topicsUnlocked: 0,
    openTierOrds: [0, 1],
    gateFirstTry: false,
    lessonsCompleted: 12,
    tracksCompleted: 0,
    bestPercentile: 81.4,
    bestTrackFraction: 0.625,
  };

  it('measures counted criteria and caps at the target', () => {
    expect(badgeProgress({ kind: 'solves', n: 10 }, stats)).toEqual({ current: 7, target: 10, label: '7 / 10 problems solved', fraction: 0.7 });
    expect(badgeProgress({ kind: 'solves_difficulty', difficulty: 'Medium', n: 5 }, stats).label).toBe('2 / 5 Medium problems solved');
    expect(badgeProgress({ kind: 'first_accept' }, stats)).toMatchObject({ current: 1, target: 1, fraction: 1 });
    expect(badgeProgress({ kind: 'lessons_completed', n: 5 }, stats)).toMatchObject({ current: 5, fraction: 1 });
    expect(badgeProgress({ kind: 'streak_days', n: 7 }, stats).label).toBe('2 / 7 days in a row');
  });

  it('measures yes/no and percentile criteria', () => {
    expect(badgeProgress({ kind: 'tier_open', tier_ord: 1 }, stats).fraction).toBe(1);
    expect(badgeProgress({ kind: 'tier_open', tier_ord: 2 }, stats).fraction).toBe(0);
    expect(badgeProgress({ kind: 'gate_first_try' }, stats).fraction).toBe(0);
    expect(badgeProgress({ kind: 'track_completed' }, stats)).toMatchObject({ fraction: 0.625, label: 'Best track 62% done' });
    const fast = badgeProgress({ kind: 'fast_solve', percentile: 90 }, stats);
    expect(fast.current).toBe(81);
    expect(fast.fraction).toBeCloseTo(81.4 / 90);
    expect(badgeProgress({ kind: 'fast_solve', percentile: 90 }, { ...stats, bestPercentile: null }).fraction).toBe(0);
  });

  it('describes every criteria kind', () => {
    const all: BadgeCriteria[] = [
      { kind: 'first_accept' },
      { kind: 'solves', n: 1 },
      { kind: 'solves_difficulty', difficulty: 'Hard', n: 2 },
      { kind: 'streak_days', n: 3 },
      { kind: 'no_hint_solves', n: 4 },
      { kind: 'topics_unlocked', n: 6 },
      { kind: 'tier_open', tier_ord: 1 },
      { kind: 'gate_first_try' },
      { kind: 'lessons_completed', n: 1 },
      { kind: 'track_completed' },
      { kind: 'fast_solve', percentile: 90 },
    ];
    for (const c of all) {
      expect(describeCriteria(c)).toMatch(/\.$/);
      expect(badgeProgress(c, stats).target).toBeGreaterThan(0);
    }
    expect(describeCriteria({ kind: 'solves', n: 1 })).toBe('Solve 1 different problem.');
    expect(describeCriteria({ kind: 'solves_difficulty', difficulty: 'Hard', n: 2 })).toBe('Solve 2 different Hard problems.');
  });
});
