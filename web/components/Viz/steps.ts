/**
 * Step generators for the lesson visualizations. Each runs the real
 * algorithm once and records a snapshot per interesting moment; the
 * components only draw a snapshot. Pure (no React) so they are unit-tested
 * against the algorithms they illustrate.
 */

// ─── binary-search ────────────────────────────────────────────────────────

export interface BinarySearchStep {
  lo: number;
  hi: number;
  mid: number | null;
  found: number | null;
  note: string;
}

export function binarySearchSteps(a: readonly number[], target: number): BinarySearchStep[] {
  const steps: BinarySearchStep[] = [
    { lo: 0, hi: a.length - 1, mid: null, found: null, note: `Looking for ${target}. The whole array is in play: lo = 0, hi = ${a.length - 1}.` },
  ];
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = lo + ((hi - lo) >> 1);
    if (a[mid] === target) {
      steps.push({ lo, hi, mid, found: mid, note: `mid = ${mid}: a[${mid}] = ${a[mid]} equals the target. Found it after ${steps.length} probes.` });
      return steps;
    }
    const right = a[mid] < target;
    steps.push({
      lo,
      hi,
      mid,
      found: null,
      note: `mid = lo + (hi − lo) / 2 = ${mid}; a[${mid}] = ${a[mid]} is ${right ? 'smaller' : 'larger'} than ${target}, so the answer can only be to the ${right ? 'right' : 'left'}.`,
    });
    const [oldLo, oldHi] = [lo, hi];
    if (right) lo = mid + 1;
    else hi = mid - 1;
    const left = Math.max(0, hi - lo + 1);
    steps.push({
      lo,
      hi,
      mid: null,
      found: null,
      note: right
        ? `Discard a[${oldLo}..${mid}]: lo = ${lo}. ${left} candidate${left === 1 ? '' : 's'} left.`
        : `Discard a[${mid}..${oldHi}]: hi = ${hi}. ${left} candidate${left === 1 ? '' : 's'} left.`,
    });
  }
  steps.push({ lo, hi, mid: null, found: null, note: `lo passed hi: ${target} is not in the array. lo = ${lo} is where it would be inserted.` });
  return steps;
}

// ─── two-pointers ─────────────────────────────────────────────────────────

export interface TwoPointerStep {
  l: number;
  r: number;
  sum: number | null;
  done: 'found' | 'none' | null;
  note: string;
}

export function twoPointerSteps(a: readonly number[], target: number): TwoPointerStep[] {
  let l = 0;
  let r = a.length - 1;
  const steps: TwoPointerStep[] = [
    { l, r, sum: null, done: null, note: `Sorted input, target ${target}. Start with one pointer at each end.` },
  ];
  while (l < r) {
    const sum = a[l] + a[r];
    if (sum === target) {
      steps.push({ l, r, sum, done: 'found', note: `a[${l}] + a[${r}] = ${a[l]} + ${a[r]} = ${sum}. That is the target: answer (${l}, ${r}).` });
      return steps;
    }
    const tooBig = sum > target;
    steps.push({
      l,
      r,
      sum,
      done: null,
      note: tooBig
        ? `${a[l]} + ${a[r]} = ${sum} > ${target}. a[${r}] is too big even with the smallest partner left, so drop it: r moves left.`
        : `${a[l]} + ${a[r]} = ${sum} < ${target}. a[${l}] is too small even with the largest partner left, so drop it: l moves right.`,
    });
    if (tooBig) r--;
    else l++;
  }
  steps.push({ l, r, sum: null, done: 'none', note: 'The pointers met: no pair adds up to the target.' });
  return steps;
}

// ─── sliding-window ───────────────────────────────────────────────────────

export interface WindowStep {
  l: number;
  /** Inclusive right edge; -1 before the first character. */
  r: number;
  window: string[];
  best: { l: number; r: number } | null;
  /** Index being added (accent) or removed (warn) this step. */
  focus: { i: number; kind: 'add' | 'remove' | 'clash' } | null;
  note: string;
}

export function slidingWindowSteps(s: string): WindowStep[] {
  const chars = [...s];
  const set = new Set<string>();
  let l = 0;
  let best: { l: number; r: number } | null = null;
  const snap = (r: number, focus: WindowStep['focus'], note: string): WindowStep => ({
    l,
    r,
    window: chars.slice(l, r + 1),
    best: best && { ...best },
    focus,
    note,
  });
  const steps: WindowStep[] = [snap(-1, null, `Find the longest run of "${s}" with no repeated character. The window starts empty.`)];
  for (let r = 0; r < chars.length; r++) {
    const c = chars[r];
    if (set.has(c)) {
      steps.push(snap(r - 1, { i: r, kind: 'clash' }, `"${c}" is already inside the window. Shrink from the left until it is gone.`));
      while (set.has(c)) {
        const gone = chars[l];
        set.delete(gone);
        l++;
        steps.push(snap(r - 1, { i: l - 1, kind: 'remove' }, `Drop "${gone}" from the left: l = ${l}.`));
      }
    }
    set.add(c);
    const len = r - l + 1;
    const improved = !best || len > best.r - best.l + 1;
    if (improved) best = { l, r };
    steps.push(
      snap(r, { i: r, kind: 'add' }, `Add "${c}": window "${chars.slice(l, r + 1).join('')}" has length ${len}.${improved ? ' New best.' : ''}`)
    );
  }
  const b = best ?? { l: 0, r: -1 };
  steps.push({ ...snap(chars.length - 1, null, `Done. Longest window without repeats: "${chars.slice(b.l, b.r + 1).join('')}" (length ${b.r - b.l + 1}). Each index entered and left the window at most once: O(n).`), l: b.l, r: b.r, window: chars.slice(b.l, b.r + 1) });
  return steps;
}

// ─── bfs-layers ───────────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  x: number;
  y: number;
}
export interface Graph {
  nodes: GraphNode[];
  edges: [string, string][];
}

export interface BfsStep {
  dist: Record<string, number>;
  queue: string[];
  done: string[];
  current: string | null;
  /** Edge under inspection and whether it discovered a node. */
  edge: { from: string; to: string; discovered: boolean } | null;
  /** Edges that discovered a node so far (the BFS tree). */
  tree: [string, string][];
  note: string;
}

export const BFS_GRAPH: Graph = {
  nodes: [
    { id: 'A', x: 40, y: 100 },
    { id: 'B', x: 130, y: 50 },
    { id: 'C', x: 130, y: 150 },
    { id: 'D', x: 220, y: 25 },
    { id: 'E', x: 220, y: 100 },
    { id: 'F', x: 220, y: 175 },
    { id: 'H', x: 310, y: 45 },
    { id: 'G', x: 310, y: 150 },
  ],
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['B', 'D'],
    ['B', 'E'],
    ['C', 'E'],
    ['C', 'F'],
    ['D', 'H'],
    ['E', 'G'],
    ['F', 'G'],
  ],
};

export function adjacency(g: Graph): Map<string, string[]> {
  const adj = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const [a, b] of g.edges) {
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  for (const list of adj.values()) list.sort();
  return adj;
}

export function bfsSteps(g: Graph, start: string): BfsStep[] {
  const adj = adjacency(g);
  const dist: Record<string, number> = { [start]: 0 };
  const queue = [start];
  const done: string[] = [];
  const tree: [string, string][] = [];
  const snap = (current: string | null, edge: BfsStep['edge'], note: string): BfsStep => ({
    dist: { ...dist },
    queue: [...queue],
    done: [...done],
    current,
    edge,
    tree: tree.map((e) => [...e] as [string, string]),
    note,
  });
  const steps: BfsStep[] = [snap(null, null, `Start at ${start} with distance 0. The queue holds just ${start}.`)];
  while (queue.length) {
    const u = queue.shift()!;
    steps.push(snap(u, null, `Dequeue ${u} (distance ${dist[u]}). Look at its neighbors: ${adj.get(u)!.join(', ')}.`));
    for (const v of adj.get(u)!) {
      if (dist[v] === undefined) {
        dist[v] = dist[u] + 1;
        queue.push(v);
        tree.push([u, v]);
        steps.push(snap(u, { from: u, to: v, discovered: true }, `${v} is new: distance ${dist[v]}, add it to the back of the queue.`));
      } else if (!done.includes(v) && v !== u) {
        steps.push(snap(u, { from: u, to: v, discovered: false }, `${v} was already discovered (distance ${dist[v]}). Skip it: the first discovery is always a shortest path.`));
      }
    }
    done.push(u);
  }
  const layers = Math.max(...Object.values(dist));
  steps.push(snap(null, null, `Queue empty. Every node was reached in order of distance: ${layers + 1} layers, each node and edge handled once — O(V + E).`));
  return steps;
}

// ─── dp-table (coin change) ───────────────────────────────────────────────

export interface CoinStep {
  /** dp values settled so far (null = not computed yet). */
  dp: (number | null)[];
  i: number | null;
  coin: number | null;
  /** Best candidate for dp[i] so far. */
  best: number | null;
  note: string;
}

export function coinChangeSteps(coins: readonly number[], amount: number): CoinStep[] {
  const INF = Number.POSITIVE_INFINITY;
  const dp: (number | null)[] = Array(amount + 1).fill(null);
  dp[0] = 0;
  const steps: CoinStep[] = [
    { dp: [...dp], i: null, coin: null, best: null, note: `dp[x] = fewest coins that make x, using coins {${coins.join(', ')}}. dp[0] = 0: zero coins make zero.` },
  ];
  for (let i = 1; i <= amount; i++) {
    let best = INF;
    for (const c of coins) {
      if (c > i) {
        steps.push({ dp: [...dp], i, coin: c, best: best === INF ? null : best, note: `dp[${i}]: coin ${c} is larger than ${i}, it cannot be the last coin.` });
        continue;
      }
      const prev = dp[i - c];
      const cand = prev === null || prev === INF ? INF : prev + 1;
      const better = cand < best;
      if (better) best = cand;
      steps.push({
        dp: [...dp],
        i,
        coin: c,
        best: best === INF ? null : best,
        note:
          cand === INF
            ? `dp[${i}]: last coin ${c} leaves ${i - c}, which cannot be made.`
            : `dp[${i}]: last coin ${c} → dp[${i - c}] + 1 = ${cand}.${better ? ' Best so far.' : ` Not better than ${best}.`}`,
      });
    }
    dp[i] = best === INF ? INF : best;
    steps.push({ dp: [...dp], i, coin: null, best: best === INF ? null : best, note: best === INF ? `dp[${i}] = ∞: ${i} cannot be made.` : `Settle dp[${i}] = ${best}.` });
  }
  const final = dp[amount];
  steps.push({
    dp: [...dp],
    i: null,
    coin: null,
    best: null,
    note: final === INF ? `No combination makes ${amount}.` : `Done: ${amount} needs ${final} coin${final === 1 ? '' : 's'}. ${amount + 1} cells × ${coins.length} coins of work: O(amount · coins).`,
  });
  return steps;
}

// ─── insertion-sort ───────────────────────────────────────────────────────

export interface InsertionStep {
  /** Array with `null` at the hole while a key is lifted out. */
  a: (number | null)[];
  /** Length of the sorted prefix. */
  sorted: number;
  key: number | null;
  hole: number | null;
  compare: number | null;
  note: string;
}

export function insertionSortSteps(input: readonly number[]): InsertionStep[] {
  const a: (number | null)[] = [...input];
  const steps: InsertionStep[] = [
    { a: [...a], sorted: 1, key: null, hole: null, compare: null, note: 'A single element is already sorted. Grow the sorted prefix one element at a time.' },
  ];
  for (let i = 1; i < a.length; i++) {
    const key = a[i] as number;
    a[i] = null;
    let hole = i;
    steps.push({ a: [...a], sorted: i, key, hole, compare: null, note: `Lift out key = ${key}, leaving a hole at index ${i}.` });
    while (hole > 0 && (a[hole - 1] as number) > key) {
      steps.push({ a: [...a], sorted: i, key, hole, compare: hole - 1, note: `${a[hole - 1]} > ${key}: shift ${a[hole - 1]} one place right.` });
      a[hole] = a[hole - 1];
      a[hole - 1] = null;
      hole--;
    }
    if (hole > 0) {
      steps.push({ a: [...a], sorted: i, key, hole, compare: hole - 1, note: `${a[hole - 1]} ≤ ${key}: stop. Everything left of the hole is smaller or equal.` });
    }
    a[hole] = key;
    steps.push({ a: [...a], sorted: i + 1, key: null, hole: null, compare: null, note: `Drop ${key} into index ${hole}. The first ${i + 1} elements are sorted.` });
  }
  steps.push({ a: [...a], sorted: a.length, key: null, hole: null, compare: null, note: 'Sorted. Worst case (reversed input) shifts every pair once: O(n²); nearly sorted input is close to O(n).' });
  return steps;
}

// ─── hash-map (two sum) ───────────────────────────────────────────────────

export interface HashStep {
  i: number | null;
  /** value → index, in insertion order. */
  map: [number, number][];
  lookup: { key: number; hit: boolean } | null;
  answer: [number, number] | null;
  note: string;
}

export function hashMapSteps(nums: readonly number[], target: number): HashStep[] {
  const map = new Map<number, number>();
  const steps: HashStep[] = [
    { i: null, map: [], lookup: null, answer: null, note: `Find two indices whose values add to ${target}. Remember every value seen so far in a map value → index.` },
  ];
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    const hit = map.has(need);
    steps.push({
      i,
      map: [...map.entries()],
      lookup: { key: need, hit },
      answer: hit ? [map.get(need)!, i] : null,
      note: hit
        ? `nums[${i}] = ${nums[i]} needs ${need}, and the map has ${need} at index ${map.get(need)}. Answer: (${map.get(need)}, ${i}).`
        : `nums[${i}] = ${nums[i]} needs ${target} − ${nums[i]} = ${need}. Not in the map (an O(1) lookup).`,
    });
    if (hit) return steps;
    map.set(nums[i], i);
    steps.push({ i, map: [...map.entries()], lookup: null, answer: null, note: `Store ${nums[i]} → ${i} so a later element can pair with it.` });
  }
  steps.push({ i: null, map: [...map.entries()], lookup: null, answer: null, note: 'No pair found.' });
  return steps;
}

// ─── bracket-stack ────────────────────────────────────────────────────────

export interface BracketStep {
  i: number | null;
  stack: string[];
  action: 'push' | 'pop' | 'mismatch' | 'leftover' | 'ok' | null;
  note: string;
}

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

export function bracketSteps(s: string): BracketStep[] {
  const stack: string[] = [];
  const steps: BracketStep[] = [
    { i: null, stack: [], action: null, note: `Check "${s}": every closer must match the most recent unmatched opener.` },
  ];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!(c in PAIRS)) {
      stack.push(c);
      steps.push({ i, stack: [...stack], action: 'push', note: `"${c}" opens: push it.` });
      continue;
    }
    const top = stack[stack.length - 1];
    if (top !== PAIRS[c]) {
      steps.push({
        i,
        stack: [...stack],
        action: 'mismatch',
        note: top ? `"${c}" closes, but the top of the stack is "${top}". Mismatch: the string is invalid.` : `"${c}" closes, but the stack is empty. Invalid.`,
      });
      return steps;
    }
    stack.pop();
    steps.push({ i, stack: [...stack], action: 'pop', note: `"${c}" matches "${top}" on top: pop.` });
  }
  steps.push(
    stack.length
      ? { i: null, stack: [...stack], action: 'leftover', note: `End of input with ${stack.length} opener(s) left unmatched. Invalid.` }
      : { i: null, stack: [], action: 'ok', note: 'End of input and the stack is empty: every bracket was matched. Valid.' }
  );
  return steps;
}

// ─── heap ─────────────────────────────────────────────────────────────────

export interface HeapStep {
  heap: number[];
  /** Index being sifted (accent). */
  active: number | null;
  /** Index it is compared with (warn). */
  compare: number | null;
  removed: number | null;
  note: string;
}

export const parentOf = (i: number) => (i - 1) >> 1;

export function heapSteps(inserts: readonly number[], pops: number): HeapStep[] {
  const h: number[] = [];
  const steps: HeapStep[] = [
    { heap: [], active: null, compare: null, removed: null, note: 'A min-heap is a complete binary tree stored in an array: the parent of i is (i − 1) / 2, and every parent is ≤ its children.' },
  ];
  const snap = (active: number | null, compare: number | null, note: string, removed: number | null = null) =>
    steps.push({ heap: [...h], active, compare, removed, note });

  for (const v of inserts) {
    h.push(v);
    let i = h.length - 1;
    snap(i, null, `Insert ${v}: append it at index ${i}, the next free leaf.`);
    while (i > 0) {
      const p = parentOf(i);
      if (h[p] <= h[i]) {
        snap(i, p, `Parent ${h[p]} ≤ ${h[i]}: heap order holds, stop.`);
        break;
      }
      snap(i, p, `Parent ${h[p]} > ${h[i]}: swap them (sift up).`);
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
      if (i === 0) snap(i, null, `${h[0]} reached the root.`);
    }
  }
  for (let k = 0; k < pops && h.length; k++) {
    const top = h[0];
    const last = h.pop()!;
    if (h.length === 0) {
      snap(null, null, `Pop the minimum ${top}. The heap is now empty.`, top);
      break;
    }
    h[0] = last;
    snap(0, null, `Pop the minimum ${top}. Move the last leaf ${last} to the root.`, top);
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l] < h[m]) m = l;
      if (r < h.length && h[r] < h[m]) m = r;
      if (m === i) {
        snap(i, null, `${h[i]} is ≤ its children: heap order restored. Both operations touch one root-to-leaf path: O(log n).`);
        break;
      }
      snap(i, m, `Smaller child ${h[m]} < ${h[i]}: swap (sift down).`);
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return steps;
}
