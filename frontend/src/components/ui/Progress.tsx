interface ProgressProps {
  value?: number;
  max?: number;
  tone?: 'accent' | 'ok' | 'warn' | 'err';
  height?: number;
}

const TONE_COLOR = {
  accent: 'var(--accent)',
  ok:     'var(--ok)',
  warn:   'var(--warn)',
  err:    'var(--err)',
} as const;

export function Progress({ value = 0, max = 100, tone = 'accent', height = 4 }: ProgressProps) {
  return (
    <div style={{ height, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
      <div
        style={{
          width: `${Math.min(100, (value / max) * 100)}%`,
          height: '100%',
          background: TONE_COLOR[tone],
          borderRadius: 2,
        }}
      />
    </div>
  );
}
