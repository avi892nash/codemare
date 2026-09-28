import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type PillTone = 'default' | 'accent' | 'ok' | 'warn' | 'err' | 'info' | 'muted';
export type PillSize = 'xs' | 'sm' | 'md';

/* Text uses the AA-safe `--*-fg` tones (see globals.css); fills and borders
 * use the raw tone. Muted text is fg-2 — fg-3 falls below 4.5:1. */
export const PILL_TONES: Record<PillTone, { bg: string; fg: string; bd: string }> = {
  default: { bg: 'var(--bg-3)',      fg: 'var(--fg-1)',      bd: 'var(--line-2)' },
  accent:  { bg: 'var(--accent-bg)', fg: 'var(--accent-hi)', bd: 'var(--accent-line)' },
  ok:      { bg: 'var(--ok-bg)',     fg: 'var(--ok-fg)',     bd: 'color-mix(in oklab, var(--ok) 30%, transparent)' },
  warn:    { bg: 'var(--warn-bg)',   fg: 'var(--warn-fg)',   bd: 'color-mix(in oklab, var(--warn) 30%, transparent)' },
  err:     { bg: 'var(--err-bg)',    fg: 'var(--err-fg)',    bd: 'color-mix(in oklab, var(--err) 30%, transparent)' },
  info:    { bg: 'var(--info-bg)',   fg: 'var(--info-fg)',   bd: 'color-mix(in oklab, var(--info) 30%, transparent)' },
  muted:   { bg: 'transparent',      fg: 'var(--fg-2)',      bd: 'var(--line-2)' },
};

interface PillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'style'> {
  children: ReactNode;
  tone?: PillTone;
  icon?: IconName;
  /** Leading status dot in the tone color. */
  dot?: boolean;
  size?: PillSize;
  className?: string;
  style?: CSSProperties;
}

/** Status / metadata capsule. Tones: default · accent · ok · warn · err · info · muted. */
export function Pill({ children, tone = 'default', icon, dot, size = 'sm', className = '', style, ...rest }: PillProps) {
  const t = PILL_TONES[tone];
  const fz = size === 'xs' ? 10.5 : size === 'md' ? 12.5 : 11.5;
  const py = size === 'xs' ? 1 : size === 'md' ? 3 : 2;
  return (
    <span
      {...rest}
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
      {dot && (
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: 999, background: 'currentColor', flex: 'none' }}
        />
      )}
      {icon && <Icon name={icon} size={fz} />}
      {children}
    </span>
  );
}
