/**
 * Pure hint-ladder rules (spec §3.6).
 */
import { HINT_LEVELS, type HintCostKind, type HintLevel } from '@/lib/types';
import { capPenalty } from './scoring';

/** What a hint belongs to: exactly one of a question or a build step. */
export type HintTarget = { questionId: string } | { buildStepId: string };

export function hintLevelRank(level: HintLevel): number {
  return HINT_LEVELS.indexOf(level);
}

/** Sort hints nudge → solution. */
export function sortByLadder<T extends { level: HintLevel }>(hints: readonly T[]): T[] {
  return [...hints].sort((a, b) => hintLevelRank(a.level) - hintLevelRank(b.level));
}

export type LadderRung<T> = T & {
  revealed: boolean;
  /** Not yet revealed, and every lower level that exists is revealed. */
  revealable: boolean;
};

/**
 * Annotate a target's hints (any order) with revealed / revealable, in
 * ladder order. Only levels that exist count: a question without a
 * `concept` hint unlocks `pseudo` right after `nudge`.
 */
export function ladderState<T extends { id: string; level: HintLevel }>(
  hints: readonly T[],
  revealedIds: ReadonlySet<string>
): LadderRung<T>[] {
  let allLowerRevealed = true;
  return sortByLadder(hints).map((h) => {
    const revealed = revealedIds.has(h.id);
    const rung = { ...h, revealed, revealable: !revealed && allLowerRevealed };
    allLowerRevealed &&= revealed;
    return rung;
  });
}

/** Lower levels (that exist) still unrevealed below `hintId` — empty when it is revealable. */
export function unrevealedBelow<T extends { id: string; level: HintLevel }>(
  hints: readonly T[],
  revealedIds: ReadonlySet<string>,
  hintId: string
): HintLevel[] {
  const target = hints.find((h) => h.id === hintId);
  if (!target) return [];
  return sortByLadder(hints)
    .filter((h) => hintLevelRank(h.level) < hintLevelRank(target.level) && !revealedIds.has(h.id))
    .map((h) => h.level);
}

/** Score penalty (%) from a target's hint uses: Σ score-kind costs, capped at 100. */
export function scorePenaltyFrom(uses: readonly { costKind: HintCostKind; costAmount: number }[]): number {
  return capPenalty(uses.filter((u) => u.costKind === 'score').reduce((s, u) => s + u.costAmount, 0));
}

/**
 * Levels missing below the highest present one — the seed rejects gaps so
 * every ladder starts at `nudge` and climbs without holes.
 */
export function ladderGaps(levels: readonly HintLevel[]): HintLevel[] {
  if (levels.length === 0) return [];
  const top = Math.max(...levels.map(hintLevelRank));
  const present = new Set(levels);
  return HINT_LEVELS.slice(0, top + 1).filter((l) => !present.has(l));
}
