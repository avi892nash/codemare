import type { TestCaseResult } from '@/lib/types';
import { Pill, fmtMem, fmtTime } from '@/components/ui/primitives';
import { Icon } from '@/components/ui/Icon';

interface TestCaseResultsProps {
  results: TestCaseResult[];
}

export function TestCaseResults({ results }: TestCaseResultsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {results.map((result, index) => {
        const [tVal, tUnit] = fmtTime(result.runMs ?? result.executionTime);
        const [mVal, mUnit] = fmtMem(result.memoryKb);
        const accent = result.passed ? 'var(--ok)' : 'var(--err)';
        return (
          <div
            key={index}
            className="card"
            style={{
              padding: 12,
              borderColor: `color-mix(in oklab, ${accent} 25%, var(--line-2))`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: result.hidden && !result.error ? 0 : 8 }}>
              <Icon
                name={result.passed ? 'check-circle' : 'x'}
                size={16}
                style={{ color: accent }}
              />
              <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg-0)' }}>
                {result.hidden ? 'Hidden test' : `Test case ${index + 1}`}
              </span>
              {result.hidden && (
                <Pill tone="muted" size="xs" icon="lock">private</Pill>
              )}
              <span style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 12, color: 'var(--fg-1)' }}>
                {tVal}
                <span style={{ color: 'var(--fg-3)' }}> {tUnit}</span>
                {result.memoryKb != null && (
                  <>
                    {' · '}
                    {mVal}
                    <span style={{ color: 'var(--fg-3)' }}> {mUnit}</span>
                  </>
                )}
              </span>
            </div>

            {!result.hidden && (
              <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 8, fontSize: 12, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--fg-3)' }}>Input</span>
                <code className="mono" style={codeStyle('var(--fg-1)')}>{JSON.stringify(result.input)}</code>

                <span style={{ color: 'var(--fg-3)' }}>Expected</span>
                <code className="mono" style={codeStyle('var(--ok)')}>{JSON.stringify(result.expectedOutput)}</code>

                <span style={{ color: 'var(--fg-3)' }}>Actual</span>
                <code className="mono" style={codeStyle(result.passed ? 'var(--ok)' : 'var(--err)')}>
                  {JSON.stringify(result.actualOutput)}
                </code>
              </div>
            )}

            {result.error && (
              <div style={{ marginTop: 8 }}>
                <code className="mono" style={{
                  display: 'block',
                  background: 'var(--err-bg)',
                  border: '1px solid color-mix(in oklab, var(--err) 25%, transparent)',
                  borderRadius: 'var(--r)',
                  padding: '8px 10px',
                  fontSize: 12,
                  color: 'var(--err)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>{result.error}</code>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function codeStyle(color: string): React.CSSProperties {
  return {
    background: 'var(--bg-2)',
    border: '1px solid var(--line-1)',
    borderRadius: 'var(--r-sm)',
    padding: '4px 8px',
    fontSize: 12,
    color,
    overflowWrap: 'anywhere',
  };
}
