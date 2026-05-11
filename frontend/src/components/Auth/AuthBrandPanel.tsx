import { BigMetric } from '../ui/BigMetric';
import { Pill } from '../ui/Pill';

/* Right column of the auth screen. Restates the brand thesis (µs-precision
 * judge) so people understand what they're signing up for, and shows a sample
 * metric strip pulled from a representative submission. Purely presentational. */
export function AuthBrandPanel() {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: 'linear-gradient(140deg, var(--bg-1), var(--bg-0))',
        borderLeft: '1px solid var(--line-2)',
        padding: 56,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 48,
        minHeight: 0,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.4,
          background:
            'radial-gradient(ellipse at 70% 20%, color-mix(in oklab, var(--accent) 25%, transparent), transparent 60%)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 420 }}>
        <Pill tone="accent" size="md" icon="zap" style={{ alignSelf: 'flex-start' }}>
          µs-precision judge
        </Pill>
        <h2 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.1 }}>
          Submission ranking is based on what your code{' '}
          <em style={{ color: 'var(--accent-hi)', fontStyle: 'normal' }}>actually did</em>, not what the host felt that minute.
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
          Codemare measures algorithm time at nanosecond precision, separates compile from run, and reports peak heap.
          No noisy wall-time leaderboards.
        </p>
      </div>

      <div
        className="card"
        style={{
          position: 'relative',
          padding: 20,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 18,
        }}
      >
        <BigMetric
          label="Runtime"
          primary={{ value: '0.21', unit: 'ms' }}
          sub={[{ k: 'wall', v: '1.4 ms' }]}
        />
        <BigMetric
          label="Memory"
          primary={{ value: '2.1', unit: 'MB' }}
          sub={[{ k: 'heap', v: '2.1 MB' }]}
        />
        <BigMetric
          label="Tests"
          primary={{ value: '58', unit: '/58' }}
          tone="ok"
        />
      </div>
    </div>
  );
}
