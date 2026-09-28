import { describe, expect, it } from 'vitest';
import { buildAward, capPenalty, percentileOf, solveAward } from './scoring';

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

describe('buildAward', () => {
  it('is BASE[step difficulty] minus the penalty rule', () => {
    expect(buildAward('Easy', 0)).toBe(1);
    expect(buildAward('Medium', 0)).toBe(2);
    expect(buildAward('Hard', 10)).toBe(3); // 2.7
    expect(buildAward('Hard', 50)).toBe(2); // 1.5
    expect(buildAward('Easy', 100)).toBe(0);
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
