import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Difficulty } from '@/lib/types';
import {
  balancesFromRows,
  bucketBalance,
  cheapestRecipe,
  compareRecipeProgress,
  meetsMinDifficulty,
  planDebits,
  qualifyingBalance,
  recipeProgress,
  topicBalance,
  type Balances,
  type Requirement,
} from './recipes';

const bal = (t: Record<string, Partial<Record<Difficulty, number>>>): Balances => t;

describe('balances', () => {
  const b = balancesFromRows([
    { topicId: 'a', difficulty: 'Easy', amount: 3 },
    { topicId: 'a', difficulty: 'Easy', amount: -1 },
    { topicId: 'a', difficulty: 'Medium', amount: 2 },
    { topicId: 'a', difficulty: 'Hard', amount: 1 },
    { topicId: 'b', difficulty: 'Hard', amount: 4 },
  ]);

  it('sums rows into buckets', () => {
    expect(b).toEqual({ a: { Easy: 2, Medium: 2, Hard: 1 }, b: { Hard: 4 } });
    expect(bucketBalance(b, 'a', 'Easy')).toBe(2);
    expect(bucketBalance(b, 'b', 'Easy')).toBe(0);
    expect(bucketBalance(b, 'zzz', 'Hard')).toBe(0);
  });

  it('topic balance is the sum of its buckets', () => {
    expect(topicBalance(b, 'a')).toBe(5);
    expect(topicBalance(b, 'b')).toBe(4);
    expect(topicBalance(b, 'missing')).toBe(0);
  });

  it('qualifying balance counts buckets with difficulty ≥ min', () => {
    expect(qualifyingBalance(b, 'a', 'Easy')).toBe(5);
    expect(qualifyingBalance(b, 'a', 'Medium')).toBe(3);
    expect(qualifyingBalance(b, 'a', 'Hard')).toBe(1);
    expect(qualifyingBalance(b, 'b', 'Medium')).toBe(4);
  });

  it('clamps a (never expected) negative bucket to 0', () => {
    expect(bucketBalance(bal({ a: { Easy: -2 } }), 'a', 'Easy')).toBe(0);
  });

  it('orders difficulties Easy < Medium < Hard', () => {
    expect(meetsMinDifficulty('Hard', 'Medium')).toBe(true);
    expect(meetsMinDifficulty('Medium', 'Medium')).toBe(true);
    expect(meetsMinDifficulty('Easy', 'Medium')).toBe(false);
  });
});

describe('planDebits', () => {
  it('debits ascending: Easy before Medium before Hard', () => {
    const plan = planDebits(bal({ a: { Easy: 1, Medium: 1, Hard: 5 } }), [
      { topicId: 'a', quantity: 3, minDifficulty: 'Easy' },
    ]);
    expect(plan).toEqual({
      ok: true,
      debits: [
        { topicId: 'a', difficulty: 'Easy', amount: 1 },
        { topicId: 'a', difficulty: 'Medium', amount: 1 },
        { topicId: 'a', difficulty: 'Hard', amount: 1 },
      ],
    });
  });

  it('skips buckets below min_difficulty', () => {
    const plan = planDebits(bal({ a: { Easy: 10, Medium: 1, Hard: 1 } }), [
      { topicId: 'a', quantity: 2, minDifficulty: 'Medium' },
    ]);
    expect(plan).toEqual({
      ok: true,
      debits: [
        { topicId: 'a', difficulty: 'Medium', amount: 1 },
        { topicId: 'a', difficulty: 'Hard', amount: 1 },
      ],
    });
  });

  it('reports every shortfall with need/have, and plans nothing', () => {
    const plan = planDebits(bal({ a: { Easy: 5 }, b: { Medium: 1 } }), [
      { topicId: 'a', quantity: 2, minDifficulty: 'Medium' },
      { topicId: 'b', quantity: 3, minDifficulty: 'Easy' },
    ]);
    expect(plan).toEqual({
      ok: false,
      shortfalls: [
        { topicId: 'a', minDifficulty: 'Medium', need: 2, have: 0 },
        { topicId: 'b', minDifficulty: 'Easy', need: 3, have: 1 },
      ],
    });
  });

  it('merges debits per bucket (one ledger row per bucket touched)', () => {
    const plan = planDebits(bal({ a: { Easy: 4 } }), [
      { topicId: 'a', quantity: 1, minDifficulty: 'Easy' },
      { topicId: 'a', quantity: 2, minDifficulty: 'Easy' },
    ]);
    expect(plan).toEqual({ ok: true, debits: [{ topicId: 'a', difficulty: 'Easy', amount: 3 }] });
  });

  it('serves the most restrictive requirement first so a feasible mix never fails', () => {
    // "2 any" listed before "1 Medium+": greedy in list order would take the Medium.
    const plan = planDebits(bal({ a: { Easy: 2, Medium: 1 } }), [
      { topicId: 'a', quantity: 2, minDifficulty: 'Easy' },
      { topicId: 'a', quantity: 1, minDifficulty: 'Medium' },
    ]);
    expect(plan).toEqual({
      ok: true,
      debits: [
        { topicId: 'a', difficulty: 'Easy', amount: 2 },
        { topicId: 'a', difficulty: 'Medium', amount: 1 },
      ],
    });
  });

  it('ignores zero-quantity requirements and succeeds on an empty list', () => {
    expect(planDebits({}, [])).toEqual({ ok: true, debits: [] });
    expect(planDebits({}, [{ topicId: 'a', quantity: 0, minDifficulty: 'Hard' }])).toEqual({ ok: true, debits: [] });
  });

  it('keeps topics independent', () => {
    const plan = planDebits(bal({ a: { Hard: 1 }, b: { Easy: 1 } }), [
      { topicId: 'b', quantity: 1, minDifficulty: 'Easy' },
      { topicId: 'a', quantity: 1, minDifficulty: 'Easy' },
    ]);
    expect(plan.ok && plan.debits).toEqual([
      { topicId: 'a', difficulty: 'Hard', amount: 1 },
      { topicId: 'b', difficulty: 'Easy', amount: 1 },
    ]);
  });
});

// ─── Exhaustive cross-check against a brute-force allocator ─────────────

type Vec = [number, number, number]; // Easy, Medium, Hard

/** Every way to cover `reqs` from buckets `b` (one topic), as total debit vectors. */
function allAllocations(b: Vec, reqs: { q: number; min: number }[]): Vec[] {
  const out: Vec[] = [];
  const rec = (i: number, left: Vec, used: Vec) => {
    if (i === reqs.length) return void out.push([...used] as Vec);
    const { q, min } = reqs[i];
    for (let e = 0; e <= (min <= 0 ? Math.min(q, left[0]) : 0); e++)
      for (let m = 0; m <= (min <= 1 ? Math.min(q - e, left[1]) : 0); m++) {
        const h = q - e - m;
        if (h < 0 || h > left[2]) continue;
        rec(i + 1, [left[0] - e, left[1] - m, left[2] - h], [used[0] + e, used[1] + m, used[2] + h]);
      }
  };
  rec(0, b, [0, 0, 0]);
  return out;
}

describe('planDebits — exhaustive check (one topic, balances 0–2, up to 2 requirements)', () => {
  const vals = [0, 1, 2];
  const reqChoices: { q: number; min: number }[] = [];
  for (let q = 0; q <= 3; q++) for (let min = 0; min < 3; min++) reqChoices.push({ q, min });
  const reqLists = [...reqChoices.map((r) => [r]), ...reqChoices.flatMap((a) => reqChoices.map((c) => [a, c]))];

  it('succeeds exactly when an allocation exists, and spends the cheapest tokens', () => {
    let cases = 0;
    for (const e of vals)
      for (const m of vals)
        for (const h of vals)
          for (const reqs of reqLists) {
            cases++;
            const b: Vec = [e, m, h];
            const requirements: Requirement[] = reqs.map((r) => ({
              topicId: 't',
              quantity: r.q,
              minDifficulty: DIFFICULTIES[r.min],
            }));
            const plan = planDebits(bal({ t: { Easy: e, Medium: m, Hard: h } }), requirements);
            const allocations = allAllocations(b, reqs);
            expect(plan.ok, JSON.stringify({ b, reqs })).toBe(allocations.length > 0);

            // recipeProgress agrees with the planner: missing = 0 ⇔ spendable.
            const progress = recipeProgress(
              {
                id: 'r',
                title: 'r',
                ord: 0,
                items: requirements.map((x) => ({ tokenTopicId: 't', quantity: x.quantity, minDifficulty: x.minDifficulty })),
              },
              bal({ t: { Easy: e, Medium: m, Hard: h } })
            );
            expect(progress.ready, JSON.stringify({ b, reqs })).toBe(plan.ok);

            if (!plan.ok) continue;
            const used: Vec = [0, 0, 0];
            for (const d of plan.debits) used[DIFFICULTIES.indexOf(d.difficulty)] += d.amount;
            // It is one of the valid allocations …
            expect(allocations).toContainEqual(used);
            // … and the cheapest: no valid allocation uses fewer Hard, or as few Hard and fewer Medium.
            const cheaper = allocations.find((a) => a[2] < used[2] || (a[2] === used[2] && a[1] < used[1]));
            expect(cheaper, JSON.stringify({ b, reqs, used })).toBeUndefined();
          }
    expect(cases).toBe(27 * reqLists.length);
  });
});

describe('recipeProgress', () => {
  const recipe = (items: [string, number, Difficulty][], ord = 0, id = `r${ord}`) => ({
    id,
    title: id,
    ord,
    items: items.map(([tokenTopicId, quantity, minDifficulty]) => ({ tokenTopicId, quantity, minDifficulty })),
  });

  it('missing = Σ max(0, quantity − qualifying balance), per item have/need', () => {
    const p = recipeProgress(
      recipe([
        ['a', 3, 'Easy'],
        ['b', 2, 'Medium'],
      ]),
      bal({ a: { Easy: 1, Hard: 1 }, b: { Easy: 9, Medium: 1 } })
    );
    expect(p.items).toEqual([
      { tokenTopicId: 'a', minDifficulty: 'Easy', need: 3, have: 2, missing: 1 },
      { tokenTopicId: 'b', minDifficulty: 'Medium', need: 2, have: 1, missing: 1 },
    ]);
    expect(p).toMatchObject({ missing: 2, totalQuantity: 5, ready: false });
  });

  it('is ready when nothing is missing (have may exceed need)', () => {
    const p = recipeProgress(recipe([['a', 2, 'Easy']]), bal({ a: { Easy: 5 } }));
    expect(p).toMatchObject({ missing: 0, ready: true, items: [{ have: 5, need: 2, missing: 0 }] });
  });

  it('does not double-count tokens two items of one topic both want', () => {
    // 3 any + 1 Medium+ needs 4 tokens; only 3 exist.
    const p = recipeProgress(
      recipe([
        ['a', 3, 'Easy'],
        ['a', 1, 'Medium'],
      ]),
      bal({ a: { Easy: 2, Medium: 1 } })
    );
    expect(p.items.map((i) => i.missing)).toEqual([1, 0]);
    expect(p.missing).toBe(1);
  });

  it('treats an empty recipe as free', () => {
    expect(recipeProgress(recipe([]), {})).toMatchObject({ missing: 0, totalQuantity: 0, ready: true });
  });
});

describe('cheapestRecipe', () => {
  const p = (ord: number, missing: number, totalQuantity: number) => ({
    recipeId: `r${ord}`,
    title: '',
    ord,
    items: [],
    missing,
    totalQuantity,
    ready: missing === 0,
  });

  it('prefers the fewest missing tokens', () => {
    expect(cheapestRecipe([p(0, 3, 3), p(1, 1, 9), p(2, 2, 2)])?.recipeId).toBe('r1');
  });

  it('breaks ties on total quantity, then ord', () => {
    expect(cheapestRecipe([p(0, 1, 5), p(1, 1, 4), p(2, 1, 4)])?.recipeId).toBe('r1');
    expect(cheapestRecipe([p(3, 0, 2), p(2, 0, 2)])?.recipeId).toBe('r2');
  });

  it('returns null without recipes and never mutates the input', () => {
    expect(cheapestRecipe([])).toBeNull();
    const list = [p(1, 1, 1), p(0, 0, 1)];
    cheapestRecipe(list);
    expect(list.map((x) => x.ord)).toEqual([1, 0]);
    expect([...list].sort(compareRecipeProgress)[0].ord).toBe(0);
  });
});
