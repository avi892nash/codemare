'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

const A = [5, 2, 9, -3, 4, 7, 1, 6]; // a[1..8], as in the article's program
const N = A.length;
const lowbit = (i: number) => i & -i;

interface Step {
  a: number[];
  tree: number[]; // 1-indexed, tree[0] unused
  active: number | null;
  used: number[];
  updated: number[];
  status: string;
  note: string;
}

function build(a: number[]): number[] {
  const tree = new Array(a.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = i - lowbit(i) + 1; j <= i; j++) tree[i] += a[j - 1];
  }
  return tree;
}

export function fenwickSteps(): Step[] {
  let a = [...A];
  let tree = build(a);
  const steps: Step[] = [
    {
      a: [...a],
      tree: [...tree],
      active: null,
      used: [],
      updated: [],
      status: 'tree built',
      note: 'Each bar is one cell of the tree: tree[i] holds the sum of the lowbit(i) elements ending at i. Taller ranges sit lower.',
    },
  ];

  const prefix = (target: number, label: string) => {
    let sum = 0;
    const used: number[] = [];
    for (let i = target; i > 0; i -= lowbit(i)) {
      sum += tree[i];
      used.push(i);
      const lo = i - lowbit(i) + 1;
      steps.push({
        a: [...a],
        tree: [...tree],
        active: i,
        used: [...used.slice(0, -1)],
        updated: [],
        status: `${label}: sum = ${sum}`,
        note: `${label}: add tree[${i}] = ${tree[i]} (a[${lo}..${i}]); sum = ${sum}. Next index ${i} − lowbit(${i}) = ${i - lowbit(i)}.`,
      });
    }
    steps.push({ a: [...a], tree: [...tree], active: null, used, updated: [], status: `${label} = ${sum}`, note: `Index 0 reached: ${label} = ${sum}, from ${used.length} cells instead of ${target} elements.` });
    return sum;
  };

  prefix(7, 'prefix(7)');

  // add(3, +10): a[3] 9 → 19
  const updated: number[] = [];
  a = a.map((v, j) => (j === 2 ? v + 10 : v));
  for (let i = 3; i <= N; i += lowbit(i)) {
    tree = tree.map((v, j) => (j === i ? v + 10 : v));
    updated.push(i);
    steps.push({
      a: [...a],
      tree: [...tree],
      active: i,
      used: [],
      updated: updated.slice(0, -1),
      status: 'add(3, +10)',
      note: `add(3, +10): tree[${i}] covers a[3], so it becomes ${tree[i]}. Next index ${i} + lowbit(${i}) = ${i + lowbit(i)}${i + lowbit(i) > N ? ' — past the end, stop.' : '.'}`,
    });
  }
  steps.push({ a: [...a], tree: [...tree], active: null, used: [], updated, status: 'a[3] = 19', note: `Only ${updated.length} cells (3, 4 and 8) cover position 3; every prefix sum is up to date.` });

  const right = prefix(6, 'prefix(6)');
  const left = prefix(2, 'prefix(2)');
  steps.push({ a: [...a], tree: [...tree], active: null, used: [], updated: [], status: `sum a[3..6] = ${right - left}`, note: `sum a[3..6] = prefix(6) − prefix(2) = ${right} − ${left} = ${right - left}.` });
  return steps;
}

const STEPS = fenwickSteps();
const LEVEL = (i: number) => Math.log2(lowbit(i)); // 0..3

export default function FenwickViz() {
  return (
    <VisualizationFrame
      title="Fenwick tree · prefix sums with updates"
      steps={STEPS}
      interval={1600}
      stageMinHeight={250}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <div className={s.fenwick} role="img" aria-label={`Fenwick tree over a[1..8]; ${st.status}`}>
            <span className={s.rowLabel}>i</span>
            {st.a.map((_, j) => (
              <span key={`i${j}`} className={s.idx}>
                {j + 1}
              </span>
            ))}
            <span className={s.rowLabel}>a</span>
            {st.a.map((v, j) => (
              <span key={`a${j}`} className={s.cell} data-state={st.updated.length && j === 2 ? 'fresh' : undefined} style={{ textDecoration: 'none' }}>
                {v}
              </span>
            ))}
            {[0, 1, 2, 3].map((level) => (
              <div key={`l${level}`} style={{ display: 'contents' }}>
                <span className={s.rowLabel} style={{ gridRow: 3 + level }}>{level === 0 ? 'tree' : ''}</span>
                {Array.from({ length: N }, (_, j) => j + 1)
                  .filter((i) => LEVEL(i) === level)
                  .map((i) => {
                    const state = st.active === i ? 'active' : st.updated.includes(i) ? 'updated' : st.used.includes(i) ? 'used' : undefined;
                    return (
                      <span
                        key={i}
                        className={s.bar}
                        data-state={state}
                        style={{ gridRow: 3 + level, gridColumn: `${i - lowbit(i) + 2} / ${i + 2}` }}
                        title={`tree[${i}] = a[${i - lowbit(i) + 1}..${i}]`}
                      >
                        {lowbit(i) > 1 ? `t${i} = ${st.tree[i]}` : st.tree[i]}
                      </span>
                    );
                  })}
              </div>
            ))}
          </div>
          <div className={s.legend} aria-hidden="true">
            <span className={s.legendItem}><span className={s.swatch} data-state="current" /> visiting</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="prime" /> added to the sum</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="fresh" /> updated</span>
            <span className={`${s.legendItem} ${s.mono}`}>{st.status}</span>
          </div>
        </div>
      )}
    />
  );
}
