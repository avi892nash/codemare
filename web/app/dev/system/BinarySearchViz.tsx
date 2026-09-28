'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './system.module.css';

interface Step {
  lo: number;
  hi: number;
  mid: number | null;
  found: boolean;
  note: string;
}

const ARRAY = [2, 5, 8, 12, 16, 23, 38, 56, 72, 91];
const TARGET = 23;

/** Precompute every state of an iterative binary search. */
function binarySearchSteps(a: number[], target: number): Step[] {
  const steps: Step[] = [{ lo: 0, hi: a.length - 1, mid: null, found: false, note: `Search for ${target} in a sorted array of ${a.length}: lo = 0, hi = ${a.length - 1}.` }];
  let lo = 0;
  let hi = a.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] === target) {
      steps.push({ lo, hi, mid, found: false, note: `mid = ⌊(${lo} + ${hi}) / 2⌋ = ${mid}; a[${mid}] = ${a[mid]}.` });
      steps.push({ lo: mid, hi: mid, mid, found: true, note: `a[${mid}] = ${target} — found at index ${mid} after ${steps.length - 1} probes.` });
      return steps;
    }
    const goRight = a[mid] < target;
    steps.push({ lo, hi, mid, found: false, note: `mid = ⌊(${lo} + ${hi}) / 2⌋ = ${mid}; a[${mid}] = ${a[mid]} ${goRight ? '<' : '>'} ${target}.` });
    if (goRight) lo = mid + 1;
    else hi = mid - 1;
    steps.push({ lo, hi, mid: null, found: false, note: goRight ? `Discard the left half: lo = ${lo}.` : `Discard the right half: hi = ${hi}.` });
  }
  steps.push({ lo, hi, mid: null, found: false, note: `${target} is not in the array.` });
  return steps;
}

const STEPS = binarySearchSteps(ARRAY, TARGET);

export function BinarySearchViz() {
  return (
    <VisualizationFrame
      title="Binary search"
      steps={STEPS}
      interval={1100}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.bsWrap}>
          <div className={`${s.bsTarget} mono`}>target = {TARGET}</div>
          <div className={s.bsCells}>
            {ARRAY.map((v, i) => (
              <div
                key={i}
                className={`${s.bsCell} mono`}
                data-out={i < st.lo || i > st.hi || undefined}
                data-mid={(st.mid === i && !st.found) || undefined}
                data-found={(st.found && st.mid === i) || undefined}
              >
                {v}
              </div>
            ))}
          </div>
          <div className={s.bsIdx} aria-hidden="true">
            {ARRAY.map((_, i) => <span key={i} className="mono">{i}</span>)}
          </div>
          <div className={s.bsIdx} aria-hidden="true">
            {ARRAY.map((_, i) => {
              const tags = [i === st.lo && 'lo', i === st.mid && 'mid', i === st.hi && 'hi'].filter(Boolean).join('·');
              const color = i === st.mid ? 'var(--accent-hi)' : 'var(--fg-1)';
              return (
                <span key={i} className={`${s.bsPtr} mono`} style={{ color }}>
                  {st.lo <= st.hi ? tags : ''}
                </span>
              );
            })}
          </div>
        </div>
      )}
    />
  );
}
