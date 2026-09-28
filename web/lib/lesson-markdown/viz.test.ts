import { describe, expect, it } from 'vitest';
import { VIZ_IDS, isVizId } from '@/components/Viz/ids';
import {
  BFS_GRAPH,
  adjacency,
  binarySearchSteps,
  bfsSteps,
  bracketSteps,
  coinChangeSteps,
  hashMapSteps,
  heapSteps,
  insertionSortSteps,
  slidingWindowSteps,
  twoPointerSteps,
} from '@/components/Viz/steps';

/** Deterministic pseudo-random ints for property checks. */
function rng(seed: number) {
  let x = seed;
  return (n: number) => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x % n;
  };
}

describe('visualization registry ids', () => {
  it('registers every visualization the brief requires', () => {
    for (const id of ['binary-search', 'two-pointers', 'sliding-window', 'bfs-layers', 'dp-table', 'insertion-sort']) {
      expect(isVizId(id)).toBe(true);
    }
    expect(isVizId('nope')).toBe(false);
    expect(isVizId('__proto__')).toBe(false);
    expect(new Set(VIZ_IDS).size).toBe(VIZ_IDS.length);
  });
});

describe('visualization steps follow the real algorithms', () => {
  it('binary search finds present targets and reports the insert point otherwise', () => {
    const a = [3, 9, 14, 20, 27, 31, 38, 45, 52, 60, 71, 88];
    for (const [i, v] of a.entries()) {
      const steps = binarySearchSteps(a, v);
      expect(steps.at(-1)!.found).toBe(i);
      expect(steps.length).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(a.length + 1)) + 1);
    }
    const miss = binarySearchSteps(a, 50).at(-1)!;
    expect(miss.found).toBeNull();
    expect(miss.lo).toBe(8); // 50 would go before 52
  });

  it('two pointers finds a pair exactly when one exists', () => {
    const r = rng(7);
    for (let t = 0; t < 200; t++) {
      const a = Array.from({ length: 2 + r(8) }, () => r(20)).sort((x, y) => x - y);
      const target = r(40);
      const last = twoPointerSteps(a, target).at(-1)!;
      const exists = a.some((x, i) => a.some((y, j) => i < j && x + y === target));
      expect(last.done).toBe(exists ? 'found' : 'none');
      if (last.done === 'found') expect(a[last.l] + a[last.r]).toBe(target);
    }
  });

  it('sliding window finds the longest substring without repeats', () => {
    const brute = (s: string) => {
      let best = 0;
      for (let i = 0; i < s.length; i++) for (let j = i; j < s.length; j++) if (new Set(s.slice(i, j + 1)).size === j - i + 1) best = Math.max(best, j - i + 1);
      return best;
    };
    const r = rng(3);
    const cases = ['abcbdeab', 'aaaa', '', 'abcdef', ...Array.from({ length: 100 }, () => Array.from({ length: r(12) }, () => 'abcd'[r(4)]).join(''))];
    for (const s of cases) {
      const last = slidingWindowSteps(s).at(-1)!;
      expect(last.window.length).toBe(brute(s));
      expect(new Set(last.window).size).toBe(last.window.length);
    }
    expect(slidingWindowSteps('abcbdeab').at(-1)!.window.join('')).toBe('cbdea');
  });

  it('BFS assigns shortest distances and finishes every reachable node once', () => {
    const steps = bfsSteps(BFS_GRAPH, 'A');
    const last = steps.at(-1)!;
    expect(last.queue).toEqual([]);
    expect(new Set(last.done).size).toBe(BFS_GRAPH.nodes.length);
    expect(last.dist).toEqual({ A: 0, B: 1, C: 1, D: 2, E: 2, F: 2, G: 3, H: 3 });
    // every tree edge joins consecutive layers
    const adj = adjacency(BFS_GRAPH);
    for (const [u, v] of last.tree) {
      expect(adj.get(u)).toContain(v);
      expect(last.dist[v]).toBe(last.dist[u] + 1);
    }
  });

  it('coin change table matches a brute-force search', () => {
    const fewest = (coins: number[], amount: number): number => {
      const memo = new Map<number, number>();
      const go = (x: number): number => {
        if (x === 0) return 0;
        if (x < 0) return Infinity;
        if (memo.has(x)) return memo.get(x)!;
        const v = Math.min(...coins.map((c) => go(x - c) + 1));
        memo.set(x, v);
        return v;
      };
      return go(amount);
    };
    expect(coinChangeSteps([1, 3, 4], 7).at(-1)!.dp).toEqual([0, 1, 2, 1, 1, 2, 2, 2]);
    for (const [coins, amount] of [[[2], 3], [[2, 5], 11], [[5, 7], 1]] as [number[], number][]) {
      const dp = coinChangeSteps(coins, amount).at(-1)!.dp;
      expect(dp[amount]).toBe(fewest(coins, amount));
    }
  });

  it('insertion sort ends sorted, with a growing sorted prefix', () => {
    const r = rng(11);
    for (let t = 0; t < 50; t++) {
      const a = Array.from({ length: 1 + r(9) }, () => r(30));
      const steps = insertionSortSteps(a);
      expect(steps.at(-1)!.a).toEqual([...a].sort((x, y) => x - y));
      for (let k = 1; k < steps.length; k++) expect(steps[k].sorted).toBeGreaterThanOrEqual(steps[k - 1].sorted);
    }
  });

  it('two-sum hash map returns indices that add to the target', () => {
    const steps = hashMapSteps([4, 9, 1, 12, 6, 3], 9);
    const answer = steps.at(-1)!.answer!;
    expect(answer).toEqual([4, 5]);
    expect(hashMapSteps([1, 2], 10).at(-1)!.answer).toBeNull();
  });

  it('bracket matching agrees with a reference checker', () => {
    const valid = (s: string) => {
      const st: string[] = [];
      const pair: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
      for (const c of s) {
        if (!(c in pair)) st.push(c);
        else if (st.pop() !== pair[c]) return false;
      }
      return st.length === 0;
    };
    for (const s of ['{[()()]}(]', '()', '([)]', '((', '', ']', '{[]}()']) {
      const last = bracketSteps(s).at(-1)!;
      expect(last.action === 'ok').toBe(valid(s));
    }
  });

  it('heap keeps heap order after every insert and pops the minimum', () => {
    const inserts = [7, 4, 9, 2, 5, 1];
    const steps = heapSteps(inserts, 1);
    const ordered = (h: number[]) => h.every((v, i) => i === 0 || h[(i - 1) >> 1] <= v);
    const popStep = steps.find((s) => s.removed !== null)!;
    expect(popStep.removed).toBe(1);
    expect(ordered(steps.at(-1)!.heap)).toBe(true);
    expect([...steps.at(-1)!.heap].sort((a, b) => a - b)).toEqual([2, 4, 5, 7, 9]);
  });
});
