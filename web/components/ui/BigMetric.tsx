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
 * The headline number of a result: tabular-mono at the page-title size
 * (`--fs-2xl`), a sentence-case label above it and optional sub-rows or a
 * percentile bar. Every line is on the type scale and at least 12 px. (It was
 * a 64 px display number with an 11 px uppercase label; a calm page leads with
 * its sentence, not a number.) Used by the submission detail.
 */
export function BigMetric({ label, primary, sub = [], pct, tone = 'default', extra }: BigMetricProps) {
  const numberColor = tone === 'ok' ? 'var(--ok)' : 'var(--fg-0)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg-2)', fontWeight: 500 }}>{label}</div>
      <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 6, lineHeight: 1.1 }}>
        <span style={{ fontSize: 'var(--fs-2xl)', fontWeight: 500, color: numberColor, letterSpacing: -0.6 }}>
          {primary.value}
        </span>
        {primary.unit && (
          <span style={{ fontSize: 'var(--fs-md)', color: 'var(--fg-2)', fontWeight: 400 }}>{primary.unit}</span>
        )}
      </div>
      {sub.length > 0 && (
        <div style={{ display: 'flex', gap: 14, fontSize: 'var(--fs-xs)' }}>
          {sub.map((s, i) => (
            <span key={i} className="mono">
              <span style={{ color: 'var(--fg-2)' }}>{s.k}</span>{' '}
              <span style={{ color: 'var(--fg-1)' }}>{s.v}</span>
            </span>
          ))}
        </div>
      )}
      {pct && (
        <div style={{ marginTop: 4 }}>
          <Progress value={pct.value} tone="accent" height={5} />
          <div className="mono" style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--fg-2)' }}>
            <span style={{ color: 'var(--accent-hi)', fontWeight: 600 }}>{pct.value}%</span> · {pct.copy}
          </div>
        </div>
      )}
      {extra && <div style={{ marginTop: 4 }}>{extra}</div>}
    </div>
  );
}
