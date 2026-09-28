'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

const S = 'abacabab'; // the article's example

interface Step {
  pi: (number | null)[];
  i: number | null;
  k: number | null;
  /** Result of comparing s[i] with s[k] in this step. */
  outcome: 'match' | 'mismatch' | 'fallback' | 'set' | null;
  note: string;
}

export function prefixSteps(str: string): Step[] {
  const n = str.length;
  const pi: (number | null)[] = new Array(n).fill(null);
  pi[0] = 0;
  const steps: Step[] = [{ pi: [...pi], i: 0, k: null, outcome: 'set', note: `π[0] = 0: a single character has no proper border.` }];
  for (let i = 1; i < n; i++) {
    let k = pi[i - 1]!;
    steps.push({
      pi: [...pi],
      i,
      k,
      outcome: null,
      note: `i = ${i}: try to extend the previous border of length k = π[${i - 1}] = ${k} by comparing s[${i}] = '${str[i]}' with s[${k}] = '${str[k]}'.`,
    });
    while (k > 0 && str[i] !== str[k]) {
      const next = pi[k - 1]!;
      steps.push({
        pi: [...pi],
        i,
        k,
        outcome: 'fallback',
        note: `'${str[i]}' ≠ '${str[k]}': the border "${str.slice(0, k)}" cannot grow. Fall back to its own longest border, k = π[${k - 1}] = ${next}${next ? `, and compare s[${i}] with s[${next}] = '${str[next]}'` : ''}.`,
      });
      k = next;
    }
    const match = str[i] === str[k];
    if (match) k++;
    pi[i] = k;
    steps.push({
      pi: [...pi],
      i,
      k: match ? k - 1 : k,
      outcome: match ? 'match' : 'mismatch',
      note: match
        ? `'${str[i]}' = '${str[i]}': the border grows to "${str.slice(0, k)}", so π[${i}] = ${k}.`
        : `'${str[i]}' ≠ '${str[0]}' and k is 0: no border ends here, π[${i}] = 0.`,
    });
  }
  steps.push({ pi: [...pi], i: null, k: null, outcome: null, note: `Done in linear time: π = [${pi.join(', ')}].` });
  return steps;
}

const STEPS = prefixSteps(S);

function charState(j: number, st: Step): string | undefined {
  if (st.i === null) return undefined;
  if (j === st.i) return st.outcome === 'match' ? 'match' : st.outcome === 'mismatch' || st.outcome === 'fallback' ? 'mismatch' : 'current';
  if (st.k !== null && j === st.k && st.outcome !== 'set') return 'compare';
  // The border being extended: s[0..k) and its copy s[i-k..i).
  if (st.k !== null && st.k > 0 && st.outcome !== 'set' && (j < st.k || (j >= st.i - st.k && j < st.i))) return 'window';
  return undefined;
}

export default function PrefixFunctionViz() {
  return (
    <VisualizationFrame
      title={`Prefix function · s = "${S}"`}
      steps={STEPS}
      interval={1800}
      stageMinHeight={220}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <div role="img" aria-label={`π so far: ${st.pi.map((v) => (v === null ? '?' : v)).join(' ')}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className={s.cells}>
              <span className={s.rowLabel} />
              {[...S].map((_, j) => (
                <span key={j} className={s.marker}>
                  {j === st.i ? 'i' : j === st.k && st.outcome !== 'set' ? 'k' : ''}
                </span>
              ))}
            </div>
            <div className={s.cells}>
              <span className={s.rowLabel}>s</span>
              {[...S].map((c, j) => (
                <span key={j} className={s.cell} data-state={charState(j, st)}>
                  {c}
                </span>
              ))}
            </div>
            <div className={s.cells}>
              <span className={s.rowLabel}>π</span>
              {st.pi.map((v, j) => (
                <span key={j} className={`${s.cell} ${s.cellSmall}`} data-state={j === st.i && v !== null ? 'new' : v !== null ? 'set' : undefined}>
                  {v ?? '·'}
                </span>
              ))}
            </div>
            <div className={s.cells}>
              <span className={s.rowLabel} />
              {[...S].map((_, j) => (
                <span key={j} className={s.idx}>
                  {j}
                </span>
              ))}
            </div>
          </div>
          <div className={s.legend} aria-hidden="true">
            <span className={s.legendItem}><span className={s.swatch} data-state="window" /> border and its copy</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="current" /> s[i]</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="compare" /> s[k]</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="prime" /> match</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="mismatch" /> mismatch → fall back</span>
          </div>
        </div>
      )}
    />
  );
}
