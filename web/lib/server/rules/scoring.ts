/**
 * Pure award math (spec §3.2, §3.6, §3.8): token amounts for solves, the
 * score-hint penalty, and the runtime percentile.
 */
import { BASE_TOKENS, type Difficulty } from '@/lib/types';

/** Sum of revealed score-kind hint costs, clamped to [0, 100]. */
export function capPenalty(sum: number): number {
  return Math.min(100, Math.max(0, sum));
}

/** Round half up, tolerant of float noise (0.1 + 0.2 style). */
function roundAward(x: number): number {
  return Math.round(x + 1e-9);
}

/**
 * Tokens for a question's first accepted submit: per topic
 * `round(BASE[difficulty] × weight × (1 − penalty/100))`; rows ≤ 0 dropped.
 */
export function solveAward(
  difficulty: Difficulty,
  topics: readonly { topicId: string; weight: number }[],
  penalty: number
): { topicId: string; amount: number }[] {
  const factor = 1 - capPenalty(penalty) / 100;
  return topics
    .map((t) => ({ topicId: t.topicId, amount: roundAward(BASE_TOKENS[difficulty] * t.weight * factor) }))
    .filter((t) => t.amount > 0);
}

/**
 * "Faster than N% of other learners": the share of `population` (latest
 * accepted runtime per user, including this one) that is strictly slower
 * than `runtimeUs`. 0–100, rounded to 2 decimals; null for an empty
 * population. This is the stored value (badges read it); what a learner is
 * shown goes through `percentileToShow`.
 */
export function percentileOf(runtimeUs: number, population: readonly number[]): number | null {
  if (population.length === 0) return null;
  const slower = population.filter((r) => r > runtimeUs).length;
  return Math.round((slower / population.length) * 10_000) / 100;
}

/**
 * How many accepted solutions (the latest per learner, same question and
 * language, the learner's own included) a percentile needs behind it before
 * it is shown: among two or three solvers "faster than 0%" or "than 67%" says
 * nothing about the learner's code.
 */
export const MIN_PERCENTILE_SAMPLE = 30;

/**
 * The percentile as the UI presents it (spec §3.8): null — so the interface
 * omits it — until `sample` solutions stand behind it. A presentation
 * threshold only: the stored percentile and the badges built on it are
 * unchanged.
 */
export function percentileToShow(percentile: number | null | undefined, sample: number, min: number = MIN_PERCENTILE_SAMPLE): number | null {
  return percentile != null && sample >= min ? percentile : null;
}
