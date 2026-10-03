import type { CSSProperties } from 'react';

export type ProgressTone = 'accent' | 'ok' | 'warn' | 'err' | 'info';

const FILL: Record<ProgressTone, string> = {
  accent: 'var(--accent)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  info: 'var(--info)',
};

export interface ProgressBarProps {
  value?: number;
  max?: number;
  tone?: ProgressTone;
  height?: number;
  /** Visible label above the bar; also names the progressbar. */
  label?: string;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  /** Show the value at the right of the label row (percent, or `valueText`). */
  showValue?: boolean;
  /** Human wording, e.g. "7 of 12 lessons" (aria-valuetext + visible value). */
  valueText?: string;
  /** Unknown duration: a sliding segment (static under reduced motion). */
  indeterminate?: boolean;
  className?: string;
  style?: CSSProperties;
}

function pct(value: number, max: number) {
  return max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
}

/** Accessible progress bar: role=progressbar with min/max/now/valuetext. Server-safe. */
export function ProgressBar({
  value = 0, max = 100, tone = 'accent', height = 4, label, showValue = false, valueText,
  indeterminate = false, className, style, 'aria-label': ariaLabel,
}: ProgressBarProps) {
  const p = pct(value, max);
  const shown = valueText ?? `${Math.round(p)}%`;
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6, ...style }}>
      {(label || showValue) && (
        <div aria-hidden="true" style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--fs-xs)' }}>
          {label && <span style={{ color: 'var(--fg-1)', fontWeight: 500 }}>{label}</span>}
          {showValue && !indeterminate && (
            <span className="mono" style={{ marginLeft: 'auto', color: 'var(--fg-2)', fontSize: 'var(--fs-xs)' }}>{shown}</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-label={label ?? ariaLabel}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuetext={indeterminate ? undefined : shown}
        aria-busy={indeterminate || undefined}
        style={{ position: 'relative', height, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: indeterminate ? '35%' : `${p}%`,
            background: FILL[tone],
            borderRadius: 2,
            transition: indeterminate ? undefined : 'width .3s ease',
            animation: indeterminate ? 'cm-indeterminate 1.3s ease-in-out infinite' : undefined,
          }}
        />
      </div>
    </div>
  );
}
