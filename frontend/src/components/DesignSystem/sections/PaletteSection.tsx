import { DSSection } from '../DSSection';
import { DSSwatch } from '../DSSwatch';

const SURFACES: Array<[name: string, token: string]> = [
  ['bg-0', 'var(--bg-0)'],
  ['bg-1', 'var(--bg-1)'],
  ['bg-2', 'var(--bg-2)'],
  ['bg-3', 'var(--bg-3)'],
  ['bg-4', 'var(--bg-4)'],
];

const LINES_AND_TEXT: Array<[name: string, token: string]> = [
  ['line-1', 'var(--line-1)'],
  ['line-2', 'var(--line-2)'],
  ['line-3', 'var(--line-3)'],
  ['fg-3',   'var(--fg-3)'],
  ['fg-0',   'var(--fg-0)'],
];

const ACCENT_AND_STATUS: Array<[name: string, token: string]> = [
  ['accent', 'var(--accent)'],
  ['ok',     'var(--ok)'],
  ['warn',   'var(--warn)'],
  ['err',    'var(--err)'],
  ['info',   'var(--info)'],
];

export function PaletteSection() {
  return (
    <>
      <DSSection kicker="01 — Palette" title="Surfaces, lines, text" span={6}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {SURFACES.map(([n, v]) => <DSSwatch key={n} name={n} value={v} />)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {LINES_AND_TEXT.map(([n, v]) => <DSSwatch key={n} name={n} value={v} />)}
        </div>
      </DSSection>

      <DSSection kicker="02 — Accent + status" title="Saturated, sparingly applied" span={6}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {ACCENT_AND_STATUS.map(([n, v]) => <DSSwatch key={n} name={n} value={v} />)}
        </div>
        <p style={{ fontSize: 12.5, color: 'var(--fg-2)', lineHeight: 1.55, margin: 0, maxWidth: 520 }}>
          Indigo is the only saturated hue used for chrome — primary CTAs, focus, active rail. Status
          tokens are reserved for verdicts, never decoration. Backgrounds for status pills are{' '}
          <code className="cd-inline">color-mix(in oklab, …, 14%)</code>.
        </p>
      </DSSection>
    </>
  );
}
