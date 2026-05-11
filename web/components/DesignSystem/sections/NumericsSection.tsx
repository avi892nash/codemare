import { DSSection } from '../DSSection';

const ROWS: Array<[label: string, runtime: string, memory: string]> = [
  ['Test 04', '0.012 ms', '1.6 KB'],
  ['Test 12', '0.184 ms', '2.1 KB'],
  ['Test 27', '1.402 ms', '18.4 MB'],
  ['Test 58', '0.143 ms', '2.1 KB'],
];

export function NumericsSection() {
  return (
    <DSSection kicker="04 — Numerics" title="Tabular, aligned" span={5}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 1fr', rowGap: 8, fontSize: 13 }}>
          <span>&nbsp;</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>Runtime</span>
          <span style={{ color: 'var(--fg-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 }}>Memory</span>
          {ROWS.map((r) => (
            <NumericsRow key={r[0]} label={r[0]} runtime={r[1]} memory={r[2]} />
          ))}
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-2)', fontSize: 11.5, color: 'var(--fg-3)' }}>
          <span className="mono" style={{ color: 'var(--fg-1)' }}>0.42 ms</span> &lt; 1ms ·{' '}
          <span className="mono" style={{ color: 'var(--fg-1)' }}>15 ms</span> ≥ 1ms ·{' '}
          <span className="mono" style={{ color: 'var(--fg-1)' }}>1.2 s</span> ≥ 1s
        </div>
      </div>
    </DSSection>
  );
}

function NumericsRow({ label, runtime, memory }: { label: string; runtime: string; memory: string }) {
  return (
    <>
      <span className="mono" style={{ color: 'var(--fg-2)' }}>{label}</span>
      <span className="mono" style={{ color: 'var(--fg-0)' }}>{runtime}</span>
      <span className="mono" style={{ color: 'var(--fg-0)' }}>{memory}</span>
    </>
  );
}
