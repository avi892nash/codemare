/**
 * Number formatting for judge metrics (µs, KB, ms, percentiles) and times.
 * Pure; returns value + unit separately so the UI can set the unit smaller
 * (MetricChip), or `text()` for inline use.
 */

export interface Metric {
  value: string;
  unit: string;
}

const NONE: Metric = { value: '—', unit: '' };

/** 3 significant digits, trailing zeros dropped: 1.24, 12.4, 124. */
function sig3(n: number): string {
  const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  return String(Number(n.toFixed(digits)));
}

/** CPU µs → "842 µs" · "1.24 ms" · "12.4 ms" · "2.1 s". */
export function formatMicros(us: number | null | undefined): Metric {
  if (us == null || !Number.isFinite(us) || us < 0) return NONE;
  if (us < 1000) return { value: String(Math.round(us)), unit: 'µs' };
  if (us < 1_000_000) return { value: sig3(us / 1000), unit: 'ms' };
  return { value: sig3(us / 1_000_000), unit: 's' };
}

/** Milliseconds (compile time, wall time) → "340 ms" · "1.61 s". */
export function formatMillis(ms: number | null | undefined): Metric {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return NONE;
  if (ms < 1) return { value: sig3(ms * 1000), unit: 'µs' };
  if (ms < 1000) return { value: ms < 10 ? sig3(ms) : String(Math.round(ms)), unit: 'ms' };
  return { value: sig3(ms / 1000), unit: 's' };
}

/** KB → "575 KB" · "12.4 MB". Null / 0 = not measured. */
export function formatKb(kb: number | null | undefined): Metric {
  if (kb == null || !Number.isFinite(kb) || kb <= 0) return NONE;
  if (kb < 1024) return { value: String(Math.round(kb)), unit: 'KB' };
  if (kb < 1024 * 1024) return { value: sig3(kb / 1024), unit: 'MB' };
  return { value: sig3(kb / (1024 * 1024)), unit: 'GB' };
}

export function text(m: Metric): string {
  return m.unit ? `${m.value} ${m.unit}` : m.value;
}

/** "Beats 87.5%" → "87.5"; whole numbers without decimals. */
export function formatPercent(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—';
  const r = Math.round(p * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "just now" · "5m ago" · "3h ago" · "2d ago" · "Sep 12". */
export function timeAgo(when: Date | string | number, now: number = Date.now()): string {
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Remaining time for a countdown: "4:05" · "1:02:09" · "0:00". */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Time limits read naturally: 2000 → "2 s", 1500 → "1.5 s", 800 → "800 ms". */
export function formatLimit(ms: number): string {
  return ms >= 1000 ? `${Number((ms / 1000).toFixed(2))} s` : `${ms} ms`;
}
