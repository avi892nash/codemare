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

/* Sizes sit on the app's type scale (globals.css --fs-*): nothing is set in
 * text smaller than --fs-xs (12 px). `icon` is the glyph size in px, which an
 * <svg> cannot take from a custom property — keep it equal to the font size. */
const SIZES: Record<PillSize, { font: string; icon: number; py: number; px: number }> = {
  xs: { font: 'var(--fs-xs)', icon: 12, py: 1, px: 8 },
  sm: { font: 'var(--fs-sm)', icon: 13, py: 2, px: 9 },
  md: { font: 'var(--fs-md)', icon: 14, py: 3, px: 10 },
};

/** Status / metadata capsule. Tones: default · accent · ok · warn · err · info · muted. */
export function Pill({ children, tone = 'default', icon, dot, size = 'sm', className = '', style, ...rest }: PillProps) {
  const t = PILL_TONES[tone];
  const { font, icon: iconSize, py, px } = SIZES[size];
  return (
    <span
      {...rest}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: `${py}px ${px}px`,
        fontSize: font,
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
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
    </span>
  );
}
