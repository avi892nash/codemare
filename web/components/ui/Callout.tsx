import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type CalloutKind = 'complexity' | 'pitfall' | 'note';

const KIND: Record<CalloutKind, { icon: IconName; title: string; tone: string; ink: string }> = {
  complexity: { icon: 'gauge',     title: 'Complexity', tone: 'var(--info)',   ink: 'var(--info-fg)' },
  pitfall:    { icon: 'alert',     title: 'Pitfall',    tone: 'var(--warn)',   ink: 'var(--warn-fg)' },
  note:       { icon: 'lightbulb', title: 'Note',       tone: 'var(--accent)', ink: 'var(--accent-hi)' },
};

interface CalloutProps {
  kind?: CalloutKind;
  /** Overrides the default heading ("Complexity" / "Pitfall" / "Note"). */
  title?: string;
  /** complexity only: rendered as mono chips, e.g. time="O(n log n)". */
  time?: string;
  space?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Lesson aside (`:::callout{kind=…}` in lesson markdown). role="note" with
 * the heading as its name. Server-safe.
 */
export function Callout({ kind = 'note', title, time, space, children, className, style }: CalloutProps) {
  const k = KIND[kind];
  const heading = title ?? k.title;
  return (
    <aside
      role="note"
      aria-label={heading}
      className={className}
      style={{
        display: 'flex',
        gap: 10,
        padding: '12px 14px',
        borderRadius: 'var(--r-md)',
        border: `1px solid color-mix(in oklab, ${k.tone} 28%, var(--line-2))`,
        background: `color-mix(in oklab, ${k.tone} 6%, var(--bg-1))`,
        ...style,
      }}
    >
      <Icon name={k.icon} size={16} style={{ color: k.ink, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: k.ink,
            marginBottom: 4,
          }}
        >
          {heading}
        </div>
        {(time || space) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '2px 0 6px' }}>
            {time && <ComplexityChip label="Time" value={time} />}
            {space && <ComplexityChip label="Space" value={space} />}
          </div>
        )}
        {children != null && (
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--fg-1)' }}>{children}</div>
        )}
      </div>
    </aside>
  );
}

function ComplexityChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        padding: '3px 8px',
        borderRadius: 'var(--r)',
        background: 'var(--bg-2)',
        border: '1px solid var(--line-2)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--fg-2)', fontSize: 11 }}>{label}</span>
      <span className="mono" style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{value}</span>
    </span>
  );
}
