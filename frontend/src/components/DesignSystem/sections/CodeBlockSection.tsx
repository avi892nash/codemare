import { DSSection } from '../DSSection';
import { CodeBlock, type CodeLine } from '../../ui/CodeBlock';

/* Hand-tokenized so the static highlighter renders exactly as the design.
 * Tuples: [tokenClass, text]. See index.css for .tk-* color rules. */
const PYTHON_SOLUTION: CodeLine[] = [
  [['tk-kw', 'def'], ['tk-pa', ' '], ['tk-fn', 'twoSum'], ['tk-mu', '('], ['tk-pa', 'nums'], ['tk-mu', ', '], ['tk-pa', 'target'], ['tk-mu', '):']],
  [['tk-pa', '    seen '], ['tk-op', '='], ['tk-pa', ' '], ['tk-mu', '{}']],
  [['tk-kw', '    for'], ['tk-pa', ' i'], ['tk-mu', ', '], ['tk-pa', 'n '], ['tk-kw', 'in'], ['tk-pa', ' '], ['tk-fn', 'enumerate'], ['tk-mu', '('], ['tk-pa', 'nums'], ['tk-mu', '):']],
  [['tk-kw', '        if'], ['tk-pa', ' target '], ['tk-op', '-'], ['tk-pa', ' n '], ['tk-kw', 'in'], ['tk-pa', ' seen']],
  [['tk-kw', '            return'], ['tk-pa', ' '], ['tk-mu', '['], ['tk-pa', 'seen'], ['tk-mu', '['], ['tk-pa', 'target '], ['tk-op', '-'], ['tk-pa', ' n'], ['tk-mu', '], '], ['tk-pa', 'i'], ['tk-mu', ']']],
  [['tk-pa', '        seen'], ['tk-mu', '['], ['tk-pa', 'n'], ['tk-mu', '] '], ['tk-op', '='], ['tk-pa', ' i']],
  [['tk-kw', '    return'], ['tk-pa', ' '], ['tk-mu', '[]']],
];

export function CodeBlockSection() {
  return (
    <DSSection kicker="09 — Code block" title="Mono, hairline, copy-able" span={12}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <CodeBlock tokens={PYTHON_SOLUTION} badge="solution.py" copy />
        <Microcopy />
      </div>
    </DSSection>
  );
}

function Microcopy() {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 11, color: 'var(--fg-3)', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8 }}>
        Microcopy
      </div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Line label="Verdict —"  body={'"Accepted in 0.21 ms" — never "Yay! 🎉"'} />
        <Line label="Error —"    body={'"Compilation failed at line 4" — never "Oops"'} />
        <Line label="Empty —"    body={'"No problems match your filters" — never "Nothing here yet!"'} />
        <Line label="Tone —"     body="senior engineer to a peer. Confident, technical, lightly playful. No marketing." />
      </ul>
    </div>
  );
}

function Line({ label, body }: { label: string; body: string }) {
  return (
    <li style={{ fontSize: 13, color: 'var(--fg-1)', lineHeight: 1.55 }}>
      <span style={{ color: 'var(--fg-3)' }}>{label} </span>
      {body}
    </li>
  );
}
