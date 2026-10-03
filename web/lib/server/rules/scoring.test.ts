import { describe, expect, it } from 'vitest';
import { capPenalty, MIN_PERCENTILE_SAMPLE, percentileOf, percentileToShow, solveAward } from './scoring';

describe('solveAward', () => {
  it('pays BASE[difficulty] per topic at weight 1', () => {
    expect(solveAward('Easy', [{ topicId: 'a', weight: 1 }], 0)).toEqual([{ topicId: 'a', amount: 1 }]);
    expect(solveAward('Medium', [{ topicId: 'a', weight: 1 }], 0)).toEqual([{ topicId: 'a', amount: 2 }]);
    expect(solveAward('Hard', [{ topicId: 'a', weight: 1 }], 0)).toEqual([{ topicId: 'a', amount: 3 }]);
  });

  it('splits by weight with rounding (composite questions)', () => {
    expect(
      solveAward('Hard', [
        { topicId: 'a', weight: 0.5 },
        { topicId: 'b', weight: 0.5 },
      ], 0)
    ).toEqual([
      { topicId: 'a', amount: 2 }, // 1.5 rounds half up
      { topicId: 'b', amount: 2 },
    ]);
    expect(solveAward('Medium', [{ topicId: 'a', weight: 0.7 }, { topicId: 'b', weight: 0.3 }], 0)).toEqual([
      { topicId: 'a', amount: 1 }, // 1.4
      { topicId: 'b', amount: 1 }, // 0.6
    ]);
  });

  it('applies the score penalty and drops rows that round to ≤ 0', () => {
    expect(solveAward('Hard', [{ topicId: 'a', weight: 1 }], 25)).toEqual([{ topicId: 'a', amount: 2 }]); // 2.25
    expect(solveAward('Easy', [{ topicId: 'a', weight: 1 }], 40)).toEqual([{ topicId: 'a', amount: 1 }]); // 0.6
    expect(solveAward('Easy', [{ topicId: 'a', weight: 1 }], 60)).toEqual([]); // 0.4
    expect(solveAward('Hard', [{ topicId: 'a', weight: 1 }], 100)).toEqual([]);
    expect(solveAward('Hard', [{ topicId: 'a', weight: 0.1 }], 0)).toEqual([]); // 0.3
  });

  it('caps the penalty at 100 and never pays negative', () => {
    expect(solveAward('Hard', [{ topicId: 'a', weight: 1 }], 250)).toEqual([]);
    expect(capPenalty(150)).toBe(100);
    expect(capPenalty(-5)).toBe(0);
  });

  it('is tolerant of float noise at .5 boundaries', () => {
    // 3 × 0.5 × (1 − 0) = 1.5 exactly; 1 × 1.5 × 1 = 1.5 exactly; both → 2
    expect(solveAward('Easy', [{ topicId: 'a', weight: 1.5 }], 0)).toEqual([{ topicId: 'a', amount: 2 }]);
    // 2 × 0.25 × (1 − 0) = 0.5 → 1
    expect(solveAward('Medium', [{ topicId: 'a', weight: 0.25 }], 0)).toEqual([{ topicId: 'a', amount: 1 }]);
  });
});

describe('percentileOf', () => {
  it('is the share of the population strictly slower', () => {
    expect(percentileOf(100, [100, 200, 300, 400])).toBe(75);
    expect(percentileOf(250, [100, 200, 250, 300])).toBe(25);
    expect(percentileOf(400, [100, 400])).toBe(0);
  });

  it('counts ties as not slower', () => {
    expect(percentileOf(100, [100, 100, 100])).toBe(0);
  });

  it('rounds to two decimals and handles empty input', () => {
    expect(percentileOf(1, [1, 2, 3])).toBe(66.67);
    expect(percentileOf(1, [])).toBeNull();
  });
});

describe('percentileToShow (presentation threshold, spec §3.8)', () => {
  it('shows nothing until MIN_PERCENTILE_SAMPLE accepted solutions stand behind the number', () => {
    expect(MIN_PERCENTILE_SAMPLE).toBe(30);
    expect(percentileToShow(87.5, 29)).toBeNull();
    expect(percentileToShow(87.5, 1)).toBeNull();
    expect(percentileToShow(0, 0)).toBeNull();
  });

  it('shows the number itself from the threshold on — including an honest 0', () => {
    expect(percentileToShow(87.5, 30)).toBe(87.5);
    expect(percentileToShow(0, 30)).toBe(0);
    expect(percentileToShow(100, 5_000)).toBe(100);
  });

  it('has nothing to show without a percentile, and takes a different minimum when asked', () => {
    expect(percentileToShow(null, 100)).toBeNull();
    expect(percentileToShow(undefined, 100)).toBeNull();
    expect(percentileToShow(50, 5, 5)).toBe(50);
    expect(percentileToShow(50, 4, 5)).toBeNull();
  });

  it('leaves the stored math alone: percentileOf still answers for a population of any size', () => {
    expect(percentileOf(1, [1])).toBe(0);
    expect(percentileOf(1, [1, 2])).toBe(50);
  });
});
