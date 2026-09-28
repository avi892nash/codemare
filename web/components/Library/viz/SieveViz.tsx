'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

const N = 40;
const NUMBERS = Array.from({ length: N - 1 }, (_, i) => i + 2);

interface Step {
  crossed: ReadonlySet<number>;
  /** Crossed out in this step. */
  fresh: ReadonlySet<number>;
  primes: ReadonlySet<number>;
  current: number | null;
  note: string;
}

export function sieveSteps(n: number): Step[] {
  const crossed = new Set<number>();
  const primes = new Set<number>();
  const steps: Step[] = [
    { crossed: new Set(), fresh: new Set(), primes: new Set(), current: null, note: `Every number from 2 to ${n} starts as a prime candidate.` },
  ];
  for (let p = 2; p * p <= n; p++) {
    if (crossed.has(p)) {
      steps.push({ crossed: new Set(crossed), fresh: new Set(), primes: new Set(primes), current: p, note: `${p} is already crossed out, so it is not prime: skip it.` });
      continue;
    }
    primes.add(p);
    steps.push({ crossed: new Set(crossed), fresh: new Set(), primes: new Set(primes), current: p, note: `${p} is still unmarked, so no smaller number divides it: ${p} is prime.` });
    const fresh = new Set<number>();
    for (let m = p * p; m <= n; m += p) if (!crossed.has(m)) fresh.add(m);
    for (const m of fresh) crossed.add(m);
    steps.push({
      crossed: new Set(crossed),
      fresh,
      primes: new Set(primes),
      current: p,
      note: `Cross out the multiples of ${p} from ${p}×${p} = ${p * p}: ${[...fresh].join(', ')}${fresh.size ? '' : 'none left'}.`,
    });
  }
  const next = Math.floor(Math.sqrt(n)) + 1;
  const all = new Set(Array.from({ length: n - 1 }, (_, i) => i + 2).filter((x) => !crossed.has(x)));
  steps.push({
    crossed: new Set(crossed),
    fresh: new Set(),
    primes: all,
    current: null,
    note: `${next}×${next} = ${next * next} > ${n}, so nothing is left to cross out. The ${all.size} unmarked numbers are the primes.`,
  });
  return steps;
}

const STEPS = sieveSteps(N);

function stateOf(x: number, st: Step): string | undefined {
  if (st.current === x) return 'current';
  if (st.fresh.has(x)) return 'fresh';
  if (st.crossed.has(x)) return 'crossed';
  if (st.primes.has(x)) return 'prime';
  return undefined;
}

export default function SieveViz() {
  return (
    <VisualizationFrame
      title={`Sieve of Eratosthenes · n = ${N}`}
      steps={STEPS}
      interval={1500}
      stageMinHeight={260}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <div className={s.grid} role="img" aria-label={`Numbers 2 to ${N}; crossed out: ${st.crossed.size}; primes found: ${st.primes.size}`}>
            {NUMBERS.map((x) => (
              <span key={x} className={s.cell} data-state={stateOf(x, st)}>
                {x}
              </span>
            ))}
          </div>
          <div className={s.legend} aria-hidden="true">
            <span className={s.legendItem}><span className={s.swatch} data-state="current" /> current prime</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="fresh" /> crossed out now</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="crossed" /> composite</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="prime" /> prime</span>
          </div>
        </div>
      )}
    />
  );
}
