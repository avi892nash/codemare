import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  /** Buttons / links — usually one primary ButtonLink. */
  action?: ReactNode;
  /** `sm` for panels (results pane, sidebars), `md` for whole pages. */
  size?: 'sm' | 'md';
  /** Heading level for the title (default 2). */
  headingLevel?: 2 | 3 | 4;
  className?: string;
  style?: CSSProperties;
}

/**
 * "Nothing here yet" block: icon tile, title, one line of help, optional
 * action. Fills and centers in its container. Server-safe.
 */
export function EmptyState({
  icon = 'layers', title, description, action, size = 'md', headingLevel = 2, className, style,
}: EmptyStateProps) {
  const H = `h${headingLevel}` as const;
  const tile = size === 'sm' ? 36 : 44;
  return (
    <div
      className={className}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: size === 'sm' ? 8 : 10,
        padding: size === 'sm' ? '24px 16px' : '48px 20px',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: tile,
          height: tile,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--r-md)',
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          color: 'var(--fg-2)',
          marginBottom: 4,
        }}
      >
        <Icon name={icon} size={size === 'sm' ? 16 : 20} />
      </span>
      <H style={{ margin: 0, fontSize: size === 'sm' ? 14 : 15.5, fontWeight: 600, letterSpacing: -0.2, color: 'var(--fg-0)' }}>
        {title}
      </H>
      {description && (
        <p style={{ margin: 0, maxWidth: 420, fontSize: size === 'sm' ? 12.5 : 13, lineHeight: 1.55, color: 'var(--fg-2)' }}>
          {description}
        </p>
      )}
      {action && <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 6 }}>{action}</div>}
    </div>
  );
}
