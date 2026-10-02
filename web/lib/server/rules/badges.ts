/**
 * Pure badge rules (spec §2.1 criteria, §3.7). The badge service computes
 * only the stats the still-unearned badges need, then asks `criteriaMet`.
 *
 * Criteria semantics ("solve" = an accepted `submit` or `gate` submission of
 * a question; runs never count):
 *   first_accept          ≥ 1 solve
 *   solves n              ≥ n distinct questions solved
 *   solves_difficulty     ≥ n distinct questions of that difficulty solved
 *   streak_days n         longest run of consecutive UTC days with a solve ≥ n
 *   no_hint_solves n      ≥ n questions solved with no hint revealed before the first solve
 *   topics_unlocked n     ≥ n topics unlocked by recipe (free tier-0 topics don't count)
 *   tier_open tier_ord    the tier with that ord is open
 *   gate_first_try        some gate passed on the user's first attempt at it
 *   lessons_completed n   ≥ n lessons completed
 *   track_completed       some track has every lesson completed and every module
 *                         checkpoint (modules that have questions) passed
 *   fast_solve percentile some accepted submit beats ≥ percentile %
 */
import type { BadgeCriteria, BadgeCriteriaKind, Difficulty } from '@/lib/types';

export interface BadgeStats {
  solveCount: number;
  solvesByDifficulty: Record<Difficulty, number>;
  longestStreak: number;
  noHintSolves: number;
  topicsUnlocked: number;
  openTierOrds: number[];
  gateFirstTry: boolean;
  lessonsCompleted: number;
  tracksCompleted: number;
  /** Best percentile over the user's accepted submits (null: none yet). */
  bestPercentile: number | null;
}

export type BadgeStatKey = keyof BadgeStats;

/** Which stat each criteria kind reads. */
export const STAT_FOR_CRITERIA: Record<BadgeCriteriaKind, BadgeStatKey> = {
  first_accept: 'solveCount',
  solves: 'solveCount',
  solves_difficulty: 'solvesByDifficulty',
  streak_days: 'longestStreak',
  no_hint_solves: 'noHintSolves',
  topics_unlocked: 'topicsUnlocked',
  tier_open: 'openTierOrds',
  gate_first_try: 'gateFirstTry',
  lessons_completed: 'lessonsCompleted',
  track_completed: 'tracksCompleted',
  fast_solve: 'bestPercentile',
};

function need<K extends BadgeStatKey>(stats: Partial<BadgeStats>, key: K): BadgeStats[K] {
  const v = stats[key];
  if (v === undefined) throw new Error(`badge stat "${key}" was not computed`);
  return v as BadgeStats[K];
}

/** Whether `criteria` holds for these stats. Throws if a needed stat is missing. */
export function criteriaMet(criteria: BadgeCriteria, stats: Partial<BadgeStats>): boolean {
  switch (criteria.kind) {
    case 'first_accept':
      return need(stats, 'solveCount') >= 1;
    case 'solves':
      return need(stats, 'solveCount') >= criteria.n;
    case 'solves_difficulty':
      return need(stats, 'solvesByDifficulty')[criteria.difficulty] >= criteria.n;
    case 'streak_days':
      return need(stats, 'longestStreak') >= criteria.n;
    case 'no_hint_solves':
      return need(stats, 'noHintSolves') >= criteria.n;
    case 'topics_unlocked':
      return need(stats, 'topicsUnlocked') >= criteria.n;
    case 'tier_open':
      return need(stats, 'openTierOrds').includes(criteria.tier_ord);
    case 'gate_first_try':
      return need(stats, 'gateFirstTry');
    case 'lessons_completed':
      return need(stats, 'lessonsCompleted') >= criteria.n;
    case 'track_completed':
      return need(stats, 'tracksCompleted') >= 1;
    case 'fast_solve': {
      const best = need(stats, 'bestPercentile');
      return best !== null && best >= criteria.percentile;
    }
  }
}

/** `YYYY-MM-DD` of a date in UTC. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Longest run of consecutive UTC days (input: `YYYY-MM-DD`, any order, duplicates ok). */
export function longestStreak(days: Iterable<string>): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of sorted) {
    const t = Date.parse(`${day}T00:00:00Z`);
    run = prev !== null && t - prev === 86_400_000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}
