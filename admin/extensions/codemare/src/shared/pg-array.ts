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

/**
 * Parse an array literal back into strings (NULL -> null). Returns null for
 * anything that is not a one-dimensional literal, so callers can leave such
 * values untouched.
 */
export function parsePgArrayLiteral(text: string): (string | null)[] | null {
  const s = text.trim();
  if (!s.startsWith('{') || !s.endsWith('}')) return null;
  const body = s.slice(1, -1);
  if (body === '') return [];
  const out: (string | null)[] = [];
  let i = 0;
  while (i <= body.length) {
    if (body[i] === '"') {
      let value = '';
      i++;
      while (i < body.length && body[i] !== '"') {
        if (body[i] === '\\') i++;
        value += body[i] ?? '';
        i++;
      }
      if (body[i] !== '"') return null;
      i++;
      out.push(value);
    } else {
      let j = i;
      while (j < body.length && body[j] !== ',') j++;
      const raw = body.slice(i, j).trim();
      if (raw.startsWith('{')) return null; // nested (multi-dimensional)
      out.push(raw.toUpperCase() === 'NULL' ? null : raw);
      i = j;
    }
    if (i >= body.length) break;
    if (body[i] !== ',') return null;
    i++;
  }
  return out;
}
