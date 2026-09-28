/**
 * Visualization ids an article's `viz_id` may use. Plain data (no React) so
 * content tests can check the seed against it without loading the
 * components; the registry in ArticleViz.tsx is typed on the same list.
 */
export const VIZ_IDS = [
  'sieve',
  'binary-exponentiation',
  'fenwick',
  'dsu',
  'dijkstra',
  'topological-sort',
  'prefix-function',
  'z-function',
] as const;

export type VizId = (typeof VIZ_IDS)[number];

export function isVizId(value: unknown): value is VizId {
  return typeof value === 'string' && (VIZ_IDS as readonly string[]).includes(value);
}
