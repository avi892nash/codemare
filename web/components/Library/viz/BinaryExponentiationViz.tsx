'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

const A = 3;
const E = 13;
const BITS = E.toString(2).split('').map(Number); // most significant first: 1 1 0 1

interface Step {
  /** Index (from the least significant end) of the bit being processed; -1 before start, BITS.length when done. */
  bit: number;
  phase: 'start' | 'multiply' | 'skip' | 'square' | 'done';
  base: number;
  /** Power of A that `base` holds. */
  basePow: number;
  result: number;
  /** Powers of A multiplied into the result so far. */
  factors: number[];
  note: string;
}

export function powerSteps(a: number, e: number): Step[] {
  const steps: Step[] = [];
  let base = a;
  let basePow = 1;
  let result = 1;
  const factors: number[] = [];
  const binary = e.toString(2);
  steps.push({
    bit: -1,
    phase: 'start',
    base,
    basePow,
    result,
    factors: [],
    note: `Compute ${a}^${e}. In binary ${e} = ${binary}, so ${a}^${e} = ${binary
      .split('')
      .reverse()
      .map((b, i) => (b === '1' ? `${a}^${2 ** i}` : null))
      .filter(Boolean)
      .reverse()
      .join(' · ')}. Start with result = 1 and base = ${a}.`,
  });
  let k = 0;
  for (let rest = e; rest > 0; rest >>= 1, k++) {
    if (rest & 1) {
      result *= base;
      factors.push(basePow);
      steps.push({
        bit: k,
        phase: 'multiply',
        base,
        basePow,
        result,
        factors: [...factors],
        note: `Bit ${k} is 1: multiply the result by base = ${a}^${basePow} = ${base}. Result = ${result}.`,
      });
    } else {
      steps.push({ bit: k, phase: 'skip', base, basePow, result, factors: [...factors], note: `Bit ${k} is 0: ${a}^${basePow} is not part of ${a}^${e}; leave the result alone.` });
    }
    if (rest >> 1) {
      base *= base;
      basePow *= 2;
      steps.push({
        bit: k,
        phase: 'square',
        base,
        basePow,
        result,
        factors: [...factors],
        note: `Square the base for the next bit: base = ${a}^${basePow} = ${base}.`,
      });
    }
  }
  steps.push({
    bit: k,
    phase: 'done',
    base,
    basePow,
    result,
    factors: [...factors],
    note: `All ${k} bits done: ${a}^${e} = ${result}, using ${k - 1} squarings and ${factors.length} multiplications instead of ${e - 1}.`,
  });
  return steps;
}

const STEPS = powerSteps(A, E);

export default function BinaryExponentiationViz() {
  return (
    <VisualizationFrame
      title={`Binary exponentiation · ${A}^${E}`}
      steps={STEPS}
      interval={1500}
      stageMinHeight={220}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <div className={s.bits} role="img" aria-label={`${E} in binary is ${E.toString(2)}${st.bit >= 0 && st.bit < BITS.length ? `; processing bit ${st.bit}` : ''}`}>
            {BITS.map((b, i) => {
              const k = BITS.length - 1 - i; // bit index from the least significant end
              const state = st.phase === 'done' ? 'done' : k === st.bit ? 'current' : k < st.bit ? 'done' : undefined;
              return (
                <span key={i} className={s.bit} data-state={state}>
                  {b}
                  <small>2^{k}</small>
                </span>
              );
            })}
          </div>
          <div className={s.panel}>
            <span className={s.key}>base</span>
            <span className={s.val}>
              {A}^{st.basePow} = <span className={st.phase === 'square' ? s.hot : undefined}>{st.base}</span>
            </span>
            <span className={s.key}>result</span>
            <span className={s.val}>
              {st.factors.length ? `${st.factors.map((p) => `${A}^${p}`).join(' · ')} = ` : ''}
              <span className={st.phase === 'multiply' || st.phase === 'done' ? s.hot : undefined}>{st.result}</span>
            </span>
          </div>
        </div>
      )}
    />
  );
}
