/**
 * Pure profile rules: UTC-day activity (heatmap, streaks), acceptance rate,
 * and progress toward a badge's criteria. No DB, no server-only.
 *
 * Days are UTC `YYYY-MM-DD` strings, matching the badge streak rule
 * (spec §3.7: "Streaks count UTC days with ≥ 1 accepted submission").
 */
import type { BadgeCriteria, Difficulty } from '@/lib/types';
import { longestStreak, utcDay, type BadgeStats } from './badges';

export { longestStreak, utcDay };

const DAY_MS = 86_400_000;

export function addDays(day: string, n: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
}

/**
 * Consecutive active days ending today — or yesterday, so a streak is not
 * "lost" before the learner had a chance to solve something today.
 */
export function currentStreak(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  let day = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export interface HeatmapDay {
  day: string;
  count: number;
  /** 0 (none) … 4 (busiest), relative to the busiest day in range. */
  level: 0 | 1 | 2 | 3 | 4;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
}

export interface Heatmap {
  days: HeatmapDay[];
  /** Weeks as columns (Sunday first); leading/trailing padding is null. */
  weeks: Array<Array<HeatmapDay | null>>;
  total: number;
  activeDays: number;
  max: number;
  from: string;
  to: string;
}

export function heatLevel(count: number, max: number): HeatmapDay['level'] {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4))) as HeatmapDay['level'];
}

/** The last `span` days up to and including `today`, laid out in week columns. */
export function buildHeatmap(counts: ReadonlyMap<string, number>, today: string, span = 365): Heatmap {
  const from = addDays(today, -(span - 1));
  const raw: Array<{ day: string; count: number }> = [];
  for (let i = 0; i < span; i++) {
    const day = addDays(from, i);
    raw.push({ day, count: Math.max(0, counts.get(day) ?? 0) });
  }
  const max = raw.reduce((m, d) => Math.max(m, d.count), 0);
  const days: HeatmapDay[] = raw.map((d) => ({
    ...d,
    level: heatLevel(d.count, max),
    weekday: new Date(`${d.day}T00:00:00Z`).getUTCDay(),
  }));
  const weeks: Array<Array<HeatmapDay | null>> = [];
  let week: Array<HeatmapDay | null> = Array(days[0]?.weekday ?? 0).fill(null);
  for (const d of days) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length) weeks.push([...week, ...Array(7 - week.length).fill(null)]);
  return {
    days,
    weeks,
    total: days.reduce((n, d) => n + d.count, 0),
    activeDays: days.filter((d) => d.count > 0).length,
    max,
    from,
    to: today,
  };
}

/** Accepted share of judged submissions, as a whole percent (null when none). */
export function acceptanceRate(accepted: number, judged: number): number | null {
  if (judged <= 0) return null;
  return Math.round((Math.min(accepted, judged) / judged) * 100);
}

// ─── Badge progress ──────────────────────────────────────────────────────

/** Everything a badge criterion can be measured against. */
export interface BadgeProgressStats extends BadgeStats {
  /** Best fraction (0–1) of any single track's requirements met. */
  bestTrackFraction: number;
}

export interface BadgeProgress {
  current: number;
  target: number;
  /** e.g. "7 / 10 problems solved". */
  label: string;
  /** 0–1. */
  fraction: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

function counted(current: number, target: number, noun: string, many?: string): BadgeProgress {
  const c = Math.min(current, target);
  return { current: c, target, label: `${c} / ${target} ${plural(target, noun, many)}`, fraction: clamp01(current / target) };
}

const DIFF_LABEL: Record<Difficulty, string> = { Easy: 'Easy', Medium: 'Medium', Hard: 'Hard' };

/** How far `stats` is toward `criteria`. */
export function badgeProgress(criteria: BadgeCriteria, stats: BadgeProgressStats): BadgeProgress {
  switch (criteria.kind) {
    case 'first_accept':
      return counted(stats.solveCount, 1, 'accepted solution');
    case 'solves':
      return counted(stats.solveCount, criteria.n, 'problem solved', 'problems solved');
    case 'solves_difficulty':
      return counted(
        stats.solvesByDifficulty[criteria.difficulty],
        criteria.n,
        `${DIFF_LABEL[criteria.difficulty]} problem solved`,
        `${DIFF_LABEL[criteria.difficulty]} problems solved`
      );
    case 'streak_days':
      return counted(stats.longestStreak, criteria.n, 'day in a row', 'days in a row');
    case 'no_hint_solves':
      return counted(stats.noHintSolves, criteria.n, 'hint-free solve');
    case 'topics_unlocked':
      return counted(stats.topicsUnlocked, criteria.n, 'topic unlocked', 'topics unlocked');
    case 'tier_open': {
      const open = stats.openTierOrds.includes(criteria.tier_ord);
      return { current: open ? 1 : 0, target: 1, label: open ? 'Tier open' : `Tier ${criteria.tier_ord} not open yet`, fraction: open ? 1 : 0 };
    }
    case 'gate_first_try':
      return {
        current: stats.gateFirstTry ? 1 : 0,
        target: 1,
        label: stats.gateFirstTry ? 'Passed a gate first try' : 'No first-try gate pass yet',
        fraction: stats.gateFirstTry ? 1 : 0,
      };
    case 'lessons_completed':
      return counted(stats.lessonsCompleted, criteria.n, 'lesson completed', 'lessons completed');
    case 'track_completed': {
      if (stats.tracksCompleted >= 1) return { current: 1, target: 1, label: 'Track completed', fraction: 1 };
      const pct = Math.floor(stats.bestTrackFraction * 100);
      return { current: 0, target: 1, label: `Best track ${pct}% done`, fraction: clamp01(stats.bestTrackFraction) };
    }
    case 'fast_solve': {
      const best = stats.bestPercentile;
      const t = criteria.percentile;
      return {
        current: Math.round(best ?? 0),
        target: t,
        label: best === null ? `Beat ${t}% of runtimes` : `Best: beats ${Math.round(best)}% (need ${t}%)`,
        fraction: clamp01((best ?? 0) / t),
      };
    }
  }
}

/** One sentence describing how to earn a badge. */
export function describeCriteria(criteria: BadgeCriteria): string {
  switch (criteria.kind) {
    case 'first_accept':
      return 'Get any submission accepted.';
    case 'solves':
      return `Solve ${criteria.n} different ${plural(criteria.n, 'problem')}.`;
    case 'solves_difficulty':
      return `Solve ${criteria.n} different ${DIFF_LABEL[criteria.difficulty]} ${plural(criteria.n, 'problem')}.`;
    case 'streak_days':
      return `Get an accepted submission on ${criteria.n} consecutive days (UTC).`;
    case 'no_hint_solves':
      return `Solve ${criteria.n} ${plural(criteria.n, 'problem')} without revealing a hint first.`;
    case 'topics_unlocked':
      return `Unlock ${criteria.n} ${plural(criteria.n, 'topic')} with recipes.`;
    case 'tier_open':
      return `Open tier ${criteria.tier_ord} by passing its gate.`;
    case 'gate_first_try':
      return 'Pass a gate exam on your first attempt.';
    case 'lessons_completed':
      return `Complete ${criteria.n} ${plural(criteria.n, 'lesson')}.`;
    case 'track_completed':
      return 'Finish every lesson and pass every checkpoint of a learning track.';
    case 'fast_solve':
      return `Submit an accepted solution that beats ${criteria.percentile}% of runtimes in its language.`;
  }
}
