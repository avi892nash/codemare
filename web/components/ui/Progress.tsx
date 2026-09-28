interface ProgressProps {
  value?: number;
  max?: number;
  tone?: 'accent' | 'ok' | 'warn' | 'err' | 'info';
  height?: number;
}

const TONE_COLOR = {
  accent: 'var(--accent)',
  ok:     'var(--ok)',
  warn:   'var(--warn)',
  err:    'var(--err)',
  info:   'var(--info)',
} as const;

/**
 * Decorative meter bar (aria-hidden) for places where the number is printed
 * right next to it — MetricChip, BigMetric. For standalone progress that
 * screen readers must hear, use <ProgressBar>.
 */
export function Progress({ value = 0, max = 100, tone = 'accent', height = 4 }: ProgressProps) {
  return (
    <div aria-hidden="true" style={{ height, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(0, max > 0 ? (value / max) * 100 : 0))}%`,
          height: '100%',
          background: TONE_COLOR[tone],
          borderRadius: 2,
        }}
      />
    </div>
  );
}
