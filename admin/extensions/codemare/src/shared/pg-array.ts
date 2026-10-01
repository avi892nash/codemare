/**
 * One-dimensional Postgres array literals, e.g. {"a","b c",NULL}.
 * https://www.postgresql.org/docs/16/arrays.html#ARRAYS-IO
 */

/** Serialize values as an array literal; every element is double-quoted. */
export function toPgArrayLiteral(values: readonly unknown[]): string {
  const parts = values.map((v) => {
    if (v === null || v === undefined) return 'NULL';
    const s = String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${s}"`;
  });
  return `{${parts.join(',')}}`;
}
