import type { Example } from '@/lib/types';

interface ProblemExamplesProps {
  examples: Example[];
}

export function ProblemExamples({ examples }: ProblemExamplesProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {examples.map((example, index) => (
        <div key={index} className="card" style={{ padding: 14 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: 'var(--fg-3)',
            marginBottom: 8,
          }}>Example {index + 1}</div>

          <ExampleField label="Input" value={example.input} accent="var(--ok)" />
          <ExampleField label="Output" value={example.output} accent="var(--info)" />

          {example.explanation && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginBottom: 4 }}>Explanation</div>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-1)', lineHeight: 1.6 }}>
                {example.explanation}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ExampleField({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginBottom: 4 }}>{label}</div>
      <code className="mono" style={{
        display: 'block',
        background: 'var(--bg-2)',
        border: '1px solid var(--line-1)',
        borderRadius: 'var(--r)',
        padding: '8px 10px',
        fontSize: 12.5,
        color: accent,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>{value}</code>
    </div>
  );
}
