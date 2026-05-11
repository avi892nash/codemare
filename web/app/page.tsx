import Link from 'next/link';

/**
 * Temporary landing page — replaced in the next commit with the actual
 * catalog (problems) experience. Keeps the scaffold render-checkable.
 */
export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ maxWidth: 520, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 11,
            color: 'var(--fg-3)',
            letterSpacing: 1.6,
            textTransform: 'uppercase',
            fontWeight: 600,
          }}
        >
          Codemare · web scaffold
        </div>
        <h1
          style={{
            margin: '8px 0 12px',
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: -0.6,
            lineHeight: 1.05,
          }}
        >
          Solve in microseconds.
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
          The Next.js app is up. The catalog, IDE, design system and auth pages
          land in the next commits.
        </p>
        <div style={{ marginTop: 24, display: 'inline-flex', gap: 12 }}>
          <Link
            href="/design-system"
            style={{
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 500,
              background: 'var(--accent)',
              color: '#0b0a14',
              borderRadius: 'var(--r)',
              textDecoration: 'none',
            }}
          >
            Design system →
          </Link>
        </div>
      </div>
    </main>
  );
}
