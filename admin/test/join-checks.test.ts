import { describe, expect, it } from 'vitest';
import {
  dependencyProblem,
  gateQuestionCountAfter,
  gateThresholdProblem,
  isValidWeight,
  type DepEdge,
} from '../extensions/codemare/src/shared/join-checks';

describe('isValidWeight', () => {
  it('accepts positive finite numbers, numeric strings included', () => {
    for (const w of [1, 0.5, 0.01, 2.5, '0.6', ' 3 ']) expect(isValidWeight(w), String(w)).toBe(true);
  });

  it('rejects zero, negatives, non-numbers and blanks', () => {
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '', ' ', 'abc', null, undefined, {}, [1]]) {
      expect(isValidWeight(w), String(w)).toBe(false);
    }
  });
});

describe('dependencyProblem', () => {
  // merge-sort → merge-sorted, range-sum → prefix-sums (as seeded)
  const edges: DepEdge[] = [
    { componentId: 'merge-sort', dependsOnId: 'merge-sorted' },
    { componentId: 'range-sum', dependsOnId: 'prefix-sums' },
  ];
  const name = (id: string) => id.toUpperCase();

  it('accepts a new edge that keeps the graph acyclic', () => {
    expect(dependencyProblem({ componentId: 'range-sum', dependsOnId: 'merge-sort' }, edges, name)).toBeNull();
    expect(dependencyProblem({ componentId: 'merge-sorted', dependsOnId: 'prefix-sums' }, edges, name)).toBeNull();
  });

  it('rejects a self-dependency', () => {
    expect(dependencyProblem({ componentId: 'gcd', dependsOnId: 'gcd' }, edges, name)).toBe('GCD cannot depend on itself');
  });

  it('rejects an edge that closes a cycle and names it with the given labels', () => {
    const direct = dependencyProblem({ componentId: 'merge-sorted', dependsOnId: 'merge-sort' }, edges, name);
    expect(direct).toMatch(/^This dependency would create a cycle: MERGE-SORT → MERGE-SORTED → MERGE-SORT\./);

    const longer = [...edges, { componentId: 'prefix-sums', dependsOnId: 'merge-sort' }];
    expect(dependencyProblem({ componentId: 'merge-sorted', dependsOnId: 'range-sum' }, longer, name)).toContain(
      'MERGE-SORT → MERGE-SORTED → RANGE-SUM → PREFIX-SUMS → MERGE-SORT'
    );
  });

  it('judges a rewritten row without its old edge (callers pass the other rows)', () => {
    // Re-pointing merge-sort → merge-sorted at prefix-sums is fine once the old edge is gone.
    const others = edges.filter((e) => e.componentId !== 'merge-sort');
    expect(dependencyProblem({ componentId: 'merge-sort', dependsOnId: 'prefix-sums' }, others, name)).toBeNull();
  });
});

describe('gateQuestionCountAfter', () => {
  const current = ['q1', 'q2', 'q3'];

  it('keeps the count when the alias is not written', () => {
    expect(gateQuestionCountAfter(current, undefined)).toBe(3);
    expect(gateQuestionCountAfter(current, null)).toBe(3);
  });

  it('takes a full list as the new set', () => {
    expect(gateQuestionCountAfter(current, ['q1', { question_id: 'x' }])).toBe(2);
  });

  it('applies nested alterations: creates add, deletes of its own rows remove, reorders change nothing', () => {
    expect(gateQuestionCountAfter(current, { create: [{}, {}], update: [], delete: [] })).toBe(5);
    expect(gateQuestionCountAfter(current, { update: [{ id: 'q2', ord: 0 }, { id: 'q1', ord: 1 }] })).toBe(3);
    expect(gateQuestionCountAfter(current, { delete: ['q1', 'q3', 'q3', 'not-mine'] })).toBe(1);
    expect(gateQuestionCountAfter(current, { create: [{}], delete: ['q1', 'q2'] })).toBe(2);
  });

  it('counts an update of another gate’s row as moving it in', () => {
    expect(gateQuestionCountAfter(current, { update: [{ id: 'elsewhere', ord: 9 }] })).toBe(4);
  });
});

describe('gateThresholdProblem', () => {
  it('passes when the gate keeps enough questions', () => {
    expect(gateThresholdProblem('Core techniques', 3, 3)).toBeNull();
    expect(gateThresholdProblem('Core techniques', 3, 4)).toBeNull();
  });

  it('explains a gate nobody could pass', () => {
    expect(gateThresholdProblem('Core techniques', 3, 2)).toBe(
      'Gate “Core techniques” needs 3 passed questions but would have 2, so nobody could ever pass it. ' +
        'Keep at least 3 questions or lower its pass threshold'
    );
    expect(gateThresholdProblem('Solo', 1, 0)).toContain('needs 1 passed question but would have 0');
  });
});
