import { Icon, type IconName } from './Icon';

interface MetricChipProps {
  value: string | number;
  unit?: string;
  label?: string;
  percentile?: number;
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
}

/**
 * The product's "reason to exist" component. Tabular-mono number, a unit and
 * an optional caption in sentence case (both 12 px, the type floor), optional
 * percentile bar. Used in the results metric strip and Learn-section
 * RunnableCodeBlock chips.
 */
export function MetricChip({ value, unit, label, percentile, size = 'md', icon }: MetricChipProps) {
  const fs = size === 'lg' ? 'var(--fs-xl)' : size === 'md' ? 'var(--fs-lg)' : 'var(--fs-sm)';
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 2, minWidth: 64 }}>
      {label && (
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--fg-2)',
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {icon && <Icon name={icon} size={12} />}
          {label}
        </div>
      )}
      <div className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
        <span style={{ fontSize: fs, fontWeight: 500, color: 'var(--fg-0)', letterSpacing: -0.3 }}>{value}</span>
        {unit && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', fontWeight: 400 }}>{unit}</span>}
      </div>
      {percentile != null && (
        <div style={{ marginTop: 2, height: 3, background: 'var(--bg-3)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${percentile}%`, height: '100%', background: 'var(--accent)' }} />
        </div>
      )}
    </div>
  );
}
