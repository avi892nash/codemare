import { Icon, type IconName } from '../ui/Icon';
import { Pill } from '../ui/Pill';

/**
 * Right-hand value panel on the auth screens: what Codemare is — a DSA
 * practice ground with µs-timed judging and a learning loop (earn tokens,
 * unlock topics, open tiers). Hidden on narrow viewports (see .auth-panel in
 * globals.css). Its content is one 440 px column, centered in the panel.
 * Server-safe.
 */
const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: 'bolt',
    title: 'Judged to the microsecond',
    body: 'Run and submit in Python, JavaScript, TypeScript, C++, Java or Go. Every test runs sandboxed and is timed in CPU microseconds.',
  },
  {
    icon: 'map',
    title: 'Unlock as you go',
    body: 'Solves earn topic tokens. Spend them to open new topics, and pass a gate to open the next tier.',
  },
  {
    icon: 'history',
    title: 'Track every run',
    body: 'Each submission keeps its code, runtime, memory and per-test results, so you can see yourself improve.',
  },
];

export function AuthValuePanel() {
  return (
    <aside
      aria-label="About Codemare"
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
        alignItems: 'center',
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

      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 440,
          display: 'flex',
          flexDirection: 'column',
          gap: 36,
        }}
      >
        <div>
          <Pill tone="accent" size="md" icon="graduation" style={{ marginBottom: 18 }}>
            Practice · Learn · Unlock
          </Pill>
          <h2 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.15 }}>
            Train on real problems.{' '}
            <span style={{ color: 'var(--accent-hi)' }}>Earn what&apos;s next.</span>
          </h2>
          <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
            Codemare is where you practice algorithms by writing and running real code,
            then turn what you solve into access to harder topics.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
    </aside>
  );
}
