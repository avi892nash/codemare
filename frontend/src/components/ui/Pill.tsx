import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type PillTone = 'default' | 'accent' | 'ok' | 'warn' | 'err' | 'info' | 'muted';
export type PillSize = 'xs' | 'sm' | 'md';

const TONES: Record<PillTone, { bg: string; fg: string; bd: string }> = {
  default: { bg: 'var(--bg-3)',     fg: 'var(--fg-1)',      bd: 'var(--line-2)' },
  accent:  { bg: 'var(--accent-bg)', fg: 'var(--accent-hi)', bd: 'var(--accent-line)' },
  ok:      { bg: 'var(--ok-bg)',     fg: 'var(--ok)',        bd: 'color-mix(in oklab, var(--ok) 30%, transparent)' },
  warn:    { bg: 'var(--warn-bg)',   fg: 'var(--warn)',      bd: 'color-mix(in oklab, var(--warn) 30%, transparent)' },
  err:     { bg: 'var(--err-bg)',    fg: 'var(--err)',       bd: 'color-mix(in oklab, var(--err) 30%, transparent)' },
  info:    { bg: 'var(--info-bg)',   fg: 'var(--info)',      bd: 'color-mix(in oklab, var(--info) 30%, transparent)' },
  muted:   { bg: 'transparent',      fg: 'var(--fg-3)',      bd: 'var(--line-2)' },
};

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  icon?: IconName;
  size?: PillSize;
  className?: string;
  style?: CSSProperties;
}

export function Pill({ children, tone = 'default', icon, size = 'sm', className = '', style }: PillProps) {
  const t = TONES[tone];
  const fz = size === 'xs' ? 10.5 : size === 'md' ? 12.5 : 11.5;
  const py = size === 'xs' ? 1 : size === 'md' ? 3 : 2;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: `${py}px 7px`,
        fontSize: fz,
        fontWeight: 500,
        lineHeight: 1.4,
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.bd}`,
        borderRadius: 999,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={fz} />}
      {children}
    </span>
  );
}
