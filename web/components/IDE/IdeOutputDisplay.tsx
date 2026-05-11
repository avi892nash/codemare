import type { IdeExecutionResponse } from '@/lib/types';
import { MetricChip, Pill, fmtMem, fmtTime } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

interface IdeOutputDisplayProps {
  results: IdeExecutionResponse | null;
}

export function IdeOutputDisplay({ results }: IdeOutputDisplayProps) {
  if (!results) {
    return (
      <div className="cm" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-0)' }}>
        <div style={{ textAlign: 'center', color: 'var(--fg-3)' }}>
          <Icon name="terminal" size={26} style={{ color: 'var(--fg-4)', marginBottom: 12 }} />
          <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-1)' }}>No results yet</p>
          <p style={{ margin: '4px 0 0', fontSize: 12 }}>Run your code to see runtime and memory.</p>
        </div>
      </div>
    );
  }

  const verdict = results.error
    ? 'XX' as const
    : results.success
      ? 'OK' as const
      : 'WA' as const;

  const accent =
    verdict === 'OK' ? 'var(--ok)' :
    verdict === 'WA' ? 'var(--warn)' :
    'var(--err)';

  const [tVal, tUnit] = fmtTime(results.totalExecutionTime);

  return (
    <div className="cm scroll" style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-0)' }}>
      <div style={{ padding: 16 }}>
        <div className="card" style={{
          padding: 14,
          marginBottom: 14,
          borderColor: `color-mix(in oklab, ${accent} 35%, var(--line-2))`,
          background: `color-mix(in oklab, ${accent} 7%, var(--bg-1))`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name={verdict === 'OK' ? 'check-circle' : verdict === 'WA' ? 'alert-circle' : 'alert'}
              size={18} style={{ color: accent }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: accent }}>
              {verdict === 'OK' ? 'All passed' : verdict === 'WA' ? 'Some failed' : 'Error'}
            </h3>
            <span style={{ flex: 1 }} />
            <Pill tone={verdict === 'OK' ? 'ok' : verdict === 'WA' ? 'warn' : 'err'} size="sm" className="mono">
              {verdict}
            </Pill>
          </div>
          <p style={{ margin: '6px 0 0', color: 'var(--fg-2)', fontSize: 12.5 }}>
            {results.totalPassed} / {results.totalTests} test cases passed · total {tVal} {tUnit}
            {results.error && <> · {results.error}</>}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.testResults.map((tr, i) => {
            const [trT, trTUnit] = fmtTime(tr.runMs ?? tr.executionTime);
            const [trM, trMUnit] = fmtMem(tr.memoryKb);
            const ok = tr.passed;
            const a = ok ? 'var(--ok)' : 'var(--err)';
            return (
              <div key={i} className="card" style={{
                padding: 12,
                borderColor: `color-mix(in oklab, ${a} 25%, var(--line-2))`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Icon name={ok ? 'check-circle' : 'x'} size={15} style={{ color: a }} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg-0)' }}>Test case {i + 1}</span>
                  <span style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-1)' }}>
                    {trT}
                    <span style={{ color: 'var(--fg-3)' }}> {trTUnit}</span>
                    {tr.memoryKb != null && tr.memoryKb > 0 && (
                      <>
                        {' · '}{trM}
                        <span style={{ color: 'var(--fg-3)' }}> {trMUnit}</span>
                      </>
                    )}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, fontSize: 12, alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ color: 'var(--fg-3)' }}>stdin</span>
                  <Pre value={tr.input} color="var(--fg-1)" />
                  <span style={{ color: 'var(--fg-3)' }}>expected</span>
                  <Pre value={tr.expectedOutput} color="var(--ok)" />
                  <span style={{ color: 'var(--fg-3)' }}>actual</span>
                  <Pre value={tr.actualOutput} color={ok ? 'var(--ok)' : 'var(--err)'} />
                </div>

                {tr.error && (
                  <Pre value={tr.error} color="var(--err)" tone="err" />
                )}
              </div>
            );
          })}
        </div>

        {results.testResults.length === 0 && results.error && (
          <MetricChip label="Error" value={results.error.slice(0, 32)} />
        )}
      </div>
    </div>
  );
}

function Pre({ value, color, tone }: { value: string; color: string; tone?: 'err' }) {
  return (
    <pre className="mono" style={{
      margin: 0,
      background: tone === 'err' ? 'var(--err-bg)' : 'var(--bg-2)',
      border: `1px solid ${tone === 'err' ? 'color-mix(in oklab, var(--err) 25%, transparent)' : 'var(--line-1)'}`,
      borderRadius: 'var(--r-sm)',
      padding: '6px 8px',
      fontSize: 11.5,
      color,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      lineHeight: 1.5,
    }}>{value || <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>{'<empty>'}</span>}</pre>
  );
}
