import { describe, expect, it } from 'vitest';
import type { HintLevel } from '@/lib/types';
import { ladderGaps, ladderState, scorePenaltyFrom, sortByLadder, unrevealedBelow } from './hints';

const h = (level: HintLevel) => ({ id: level, level });

describe('ladder', () => {
  const all = [h('solution'), h('nudge'), h('line'), h('concept'), h('pseudo')];

  it('sorts nudge → concept → pseudo → line → solution', () => {
    expect(sortByLadder(all).map((x) => x.level)).toEqual(['nudge', 'concept', 'pseudo', 'line', 'solution']);
  });

  it('only the next unrevealed level is revealable', () => {
    expect(ladderState(all, new Set()).map((r) => [r.level, r.revealed, r.revealable])).toEqual([
      ['nudge', false, true],
      ['concept', false, false],
      ['pseudo', false, false],
      ['line', false, false],
      ['solution', false, false],
    ]);
    expect(
      ladderState(all, new Set(['nudge', 'concept'])).map((r) => [r.level, r.revealed, r.revealable])
    ).toEqual([
      ['nudge', true, false],
      ['concept', true, false],
      ['pseudo', false, true],
      ['line', false, false],
      ['solution', false, false],
    ]);
  });

  it('only counts levels that exist', () => {
    const sparse = [h('nudge'), h('pseudo')];
    expect(ladderState(sparse, new Set(['nudge'])).map((r) => r.revealable)).toEqual([false, true]);
  });

  it('lists unrevealed lower levels blocking a reveal', () => {
    expect(unrevealedBelow(all, new Set(), 'pseudo')).toEqual(['nudge', 'concept']);
    expect(unrevealedBelow(all, new Set(['nudge']), 'pseudo')).toEqual(['concept']);
    expect(unrevealedBelow(all, new Set(['nudge', 'concept']), 'pseudo')).toEqual([]);
    expect(unrevealedBelow(all, new Set(), 'nudge')).toEqual([]);
  });

  it('finds gaps below the highest level', () => {
    expect(ladderGaps(['nudge', 'concept', 'pseudo'])).toEqual([]);
    expect(ladderGaps(['nudge', 'pseudo'])).toEqual(['concept']);
    expect(ladderGaps(['solution'])).toEqual(['nudge', 'concept', 'pseudo', 'line']);
    expect(ladderGaps([])).toEqual([]);
  });
});

describe('scorePenaltyFrom', () => {
  it('sums score costs only, capped at 100', () => {
    expect(scorePenaltyFrom([])).toBe(0);
    expect(
      scorePenaltyFrom([
        { costKind: 'score', costAmount: 10 },
        { costKind: 'token', costAmount: 50 },
        { costKind: 'score', costAmount: 25 },
      ])
    ).toBe(35);
    expect(
      scorePenaltyFrom([
        { costKind: 'score', costAmount: 40 },
        { costKind: 'score', costAmount: 100 },
      ])
    ).toBe(100);
  });
});
