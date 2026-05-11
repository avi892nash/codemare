import type { ReactNode } from 'react';

/* Tiny inline keyboard shortcut tag — used inside Button kbd= and Input kbd=. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      className="mono"
      style={{
        fontSize: 10.5,
        padding: '1px 5px',
        borderRadius: 4,
        background: 'var(--bg-3)',
        color: 'var(--fg-2)',
        border: '1px solid var(--line-2)',
        marginLeft: 4,
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
