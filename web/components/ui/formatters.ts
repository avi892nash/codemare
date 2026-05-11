/* Time / memory formatters per the design brief.
 * Used by every component that renders a metric value. */
export function fmtTime(ms: number | null | undefined): [string, string] {
  if (ms == null) return ['—', ''];
  if (ms < 1) return [ms.toFixed(2), 'ms'];
  if (ms < 1000) return [Math.round(ms).toString(), 'ms'];
  return [(ms / 1000).toFixed(1), 's'];
}

export function fmtMem(kb: number | null | undefined): [string, string] {
  if (kb == null) return ['—', ''];
  if (kb < 1024) return [kb.toFixed(1), 'KB'];
  return [(kb / 1024).toFixed(1), 'MB'];
}
