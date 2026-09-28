import type { CSSProperties, ReactNode } from 'react';

/**
 * Tiny inline keyboard shortcut tag — used inside Button kbd= and Input kbd=,
 * and standalone in prose ("Press <Kbd>⌘K</Kbd>"). Pass `bare` to drop the
 * leading gap it carries for sitting after a label.
 */
export function Kbd({
  children, bare = false, className, style,
}: { children: ReactNode; bare?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <kbd
      className={`mono ${className ?? ''}`.trim()}
      style={{
        display: 'inline-block',
        fontSize: 10.5,
        padding: '1px 5px',
        borderRadius: 4,
        background: 'var(--bg-3)',
        color: 'var(--fg-2)',
        border: '1px solid var(--line-2)',
        borderBottomColor: 'var(--line-3)',
        marginLeft: bare ? 0 : 4,
        lineHeight: 1.4,
        fontWeight: 500,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </kbd>
  );
}
