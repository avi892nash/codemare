import { Pill } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

export const metadata = {
  title: 'IDE · Codemare',
};

/**
 * IDE landing — placeholder. The full IDE (Monaco editor + test-case manager
 * + stdin/stdout panel) is wired in a follow-up commit alongside the run
 * server action that proxies to the compile service with the internal token.
 */
export default function IDEPage() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <Pill tone="accent" size="md" icon="terminal" style={{ marginBottom: 16 }}>
          IDE
        </Pill>
        <h1 style={{ margin: '0 0 8px', fontSize: 24, fontWeight: 600, letterSpacing: -0.4 }}>
          Free-form playground
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Write a complete program, define custom stdin / expected stdout, and run.
          Coming online with Monaco + the compile-service proxy.
        </p>
        <div style={{ marginTop: 18, color: 'var(--fg-4)', fontSize: 12 }}>
          <Icon name="clock" size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Landing in a follow-up commit.
        </div>
      </div>
    </div>
  );
}
