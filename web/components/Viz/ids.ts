/**
 * The visualization vocabulary lesson markdown may reference with
 * `:::viz{id=…}`. Pure data (no React) so the parser tests, the content
 * checks and server components can validate ids without loading any
 * visualization code. The components themselves are registered in
 * VizMount.tsx, one dynamic import each.
 */
export const VIZ_META = {
  'binary-search': { title: 'Binary search: halving the range' },
  'two-pointers': { title: 'Two pointers on a sorted array' },
  'sliding-window': { title: 'Sliding window without repeats' },
  'bfs-layers': { title: 'Breadth-first search, layer by layer' },
  'dp-table': { title: 'Coin change: filling the DP table' },
  'insertion-sort': { title: 'Insertion sort' },
  'hash-map': { title: 'Two sum with a hash map' },
  'bracket-stack': { title: 'Matching brackets with a stack' },
  'heap': { title: 'Min-heap: sift up, sift down' },
} as const satisfies Record<string, { title: string }>;

export type VizId = keyof typeof VIZ_META;

export const VIZ_IDS = Object.keys(VIZ_META) as VizId[];

export function isVizId(id: string): id is VizId {
  return Object.prototype.hasOwnProperty.call(VIZ_META, id);
}
