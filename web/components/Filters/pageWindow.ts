/** Page numbers for a pager: first, last, current ± 1; `null` marks a gap. Pure. */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  const keep = new Set([1, pageCount, page - 1, page, page + 1]);
  const out: Array<number | null> = [];
  for (let p = 1; p <= pageCount; p++) {
    if (keep.has(p)) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}
