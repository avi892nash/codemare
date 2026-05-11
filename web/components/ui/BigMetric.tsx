import type { ReactNode } from 'react';
import { Progress } from './Progress';

interface BigMetricProps {
  label: string;
  primary: { value: string | number; unit?: string };
  sub?: Array<{ k: string; v: string }>;
  pct?: { value: number; copy: string };
  tone?: 'default' | 'ok';
  extra?: ReactNode;
}

/**
 * Large 64px tabular-mono number with a small uppercase label and optional
 * sub-rows or a percentile bar. Used in the auth brand panel, the Results hero
 * standalone view, and the track-completion screen.
 */
export function BigMetric({ label, primary, sub = [], pct, tone = 'default', extra }: BigMetricProps) {
  const numberColor = tone === 'ok' ? 'var(--ok)' : 'var(--fg-0)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--fg-3)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 6, lineHeight: 0.95 }}>
        <span style={{ fontSize: 64, fontWeight: 500, color: numberColor, letterSpacing: -1.6 }}>
          {primary.value}
        </span>
        {primary.unit && (
          <span style={{ fontSize: 22, color: 'var(--fg-3)', fontWeight: 400 }}>{primary.unit}</span>
        )}
      </div>
      {sub.length > 0 && (
        <div style={{ display: 'flex', gap: 14, fontSize: 11.5 }}>
          {sub.map((s, i) => (
            <span key={i} className="mono">
              <span style={{ color: 'var(--fg-4)' }}>{s.k}</span>{' '}
              <span style={{ color: 'var(--fg-1)' }}>{s.v}</span>
            </span>
          ))}
        </div>
      )}
      {pct && (
        <div style={{ marginTop: 4 }}>
          <Progress value={pct.value} tone="accent" height={5} />
          <div className="mono" style={{ marginTop: 6, fontSize: 11, color: 'var(--fg-2)' }}>
            <span style={{ color: 'var(--accent-hi)', fontWeight: 600 }}>{pct.value}%</span> · {pct.copy}
          </div>
        </div>
      )}
      {extra && <div style={{ marginTop: 4 }}>{extra}</div>}
    </div>
  );
}
