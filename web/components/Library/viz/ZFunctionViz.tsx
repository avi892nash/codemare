'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

const S = 'aabcaabxaaz'; // the article's example

interface Step {
  z: (number | null)[];
  i: number | null;
  l: number;
  r: number;
  /** Characters s[i .. i+len) matched against s[0 .. len). */
  len: number;
  note: string;
}

export function zSteps(str: string): Step[] {
  const n = str.length;
  const z: (number | null)[] = new Array(n).fill(null);
  z[0] = 0;
  let l = 0;
  let r = 0;
  const steps: Step[] = [{ z: [...z], i: null, l, r, len: 0, note: `z[0] is 0 by convention. The window [l, r) — the match reaching furthest right — starts empty.` }];
  for (let i = 1; i < n; i++) {
    let v = 0;
    let why: string;
    if (i < r) {
      v = Math.min(r - i, z[i - l]!);
      why = `${i} lies inside the window [${l}, ${r}), which copies s[0..${r - l}). So z[${i}] ≥ min(r − i, z[${i - l}]) = min(${r - i}, ${z[i - l]}) = ${v} for free`;
    } else {
      why = `${i} is outside the window, so start from 0`;
    }
    const start = v;
    while (i + v < n && str[v] === str[i + v]) v++;
    z[i] = v;
    const extended = v - start;
    const stop = i + v < n ? `'${str[i + v]}' ≠ '${str[v]}'` : 'the end of the string';
    const moved = i + v > r;
    if (moved) {
      l = i;
      r = i + v;
    }
    steps.push({
      z: [...z],
      i,
      l,
      r,
      len: v,
      note: `${why}; ${extended ? `direct comparison adds ${extended} more` : 'no further characters match'} (stops at ${stop}). z[${i}] = ${v}.${
        moved ? ` The match reaches past the old window: it becomes [${l}, ${r}).` : ''
      }`,
    });
  }
  steps.push({ z: [...z], i: null, l, r, len: 0, note: `z = [${z.join(', ')}]. The window only moves right, so the total work is linear.` });
  return steps;
}

const STEPS = zSteps(S);

function charState(j: number, st: Step): string | undefined {
  if (st.i === null) return undefined;
  if (j >= st.i && j < st.i + st.len) return 'match';
  if (j === st.i) return 'current';
  if (j < st.len) return 'compare';
  if (j >= st.l && j < st.r) return 'window';
  return undefined;
}

export default function ZFunctionViz() {
  return (
    <VisualizationFrame
      title={`Z-function · s = "${S}"`}
      steps={STEPS}
      interval={1900}
      stageMinHeight={220}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <div role="img" aria-label={`z so far: ${st.z.map((v) => (v === null ? '?' : v)).join(' ')}; window [${st.l}, ${st.r})`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className={s.cells}>
              <span className={s.rowLabel} />
              {[...S].map((_, j) => (
                <span key={j} className={s.marker}>
                  {[j === st.i && 'i', j === st.l && st.r > st.l && 'l', j === st.r && st.r > st.l && 'r'].filter(Boolean).join('·')}
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
              <span className={s.rowLabel}>z</span>
              {st.z.map((v, j) => (
                <span key={j} className={`${s.cell} ${s.cellSmall}`} data-state={j === st.i ? 'new' : v !== null ? 'set' : undefined}>
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
            <span className={s.legendItem}><span className={s.swatch} data-state="prime" /> s[i..] matching the prefix</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="compare" /> the prefix it matches</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="window" /> window [l, r)</span>
          </div>
        </div>
      )}
    />
  );
}
