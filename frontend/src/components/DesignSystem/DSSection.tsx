import type { ReactNode } from 'react';

/* Layout primitive used by every section in the design system. The 12-column
 * grid is set up by DesignSystemPage; sections opt in by setting `span`. */
interface DSSectionProps {
  kicker: string;
  title: string;
  children: ReactNode;
  span?: number;
}

export function DSSection({ kicker, title, children, span = 12 }: DSSectionProps) {
  return (
    <section
      style={{
        gridColumn: `span ${span}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <header>
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--fg-3)',
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          {kicker}
        </div>
        <h3
          style={{
            margin: '2px 0 0',
            fontSize: 18,
            fontWeight: 600,
            color: 'var(--fg-0)',
            letterSpacing: -0.2,
          }}
        >
          {title}
        </h3>
      </header>
      {children}
    </section>
  );
}
