import { Icon, type IconName } from '../ui/Icon';
import { Pill } from '../ui/Pill';

/**
 * Right-hand value panel on the auth screen. On-message for what Codemare is:
 * a place to practice DSA / competitive programming and to author and share
 * problem sets — not the old µs-timing pitch. Hidden on narrow viewports
 * (see .auth-panel in globals.css).
 */
const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'graduation',
    title: 'Learn by doing',
    body: 'Solve curated DSA and competitive-programming problems with instant, sandboxed judging in Python, JavaScript, C++ and Java.',
  },
  {
    icon: 'book',
    title: 'Author your own',
    body: 'Build books of lessons and problems, set test cases, and share them with everyone who’s learning.',
  },
  {
    icon: 'trend',
    title: 'Track every run',
    body: 'Submissions are saved with per-problem runtime and memory, so you can see yourself improve.',
  },
];

export function AuthValuePanel() {
  return (
    <div
      className="auth-panel"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(150deg, var(--bg-1), var(--bg-0))',
        borderLeft: '1px solid var(--line-2)',
        padding: 56,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 36,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.35,
          background:
            'radial-gradient(ellipse at 75% 15%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', maxWidth: 440 }}>
        <Pill tone="accent" size="md" icon="graduation" style={{ marginBottom: 18 }}>
          Practice · Author · Share
        </Pill>
        <h2 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.15 }}>
          Train on real problems.{' '}
          <span style={{ color: 'var(--accent-hi)' }}>Build your own.</span>
        </h2>
        <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Codemare is where you practice algorithms by writing and running code —
          and where anyone can author lessons and problem sets to teach what they know.
        </p>
      </div>

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 440 }}>
        {FEATURES.map((f) => (
          <div key={f.title} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div
              style={{
                flex: 'none',
                width: 34,
                height: 34,
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--accent-bg)',
                border: '1px solid var(--accent-line)',
                color: 'var(--accent-hi)',
              }}
            >
              <Icon name={f.icon} size={16} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-0)' }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55, marginTop: 2 }}>{f.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
