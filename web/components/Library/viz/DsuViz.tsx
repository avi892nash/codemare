'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

const N = 8;
// The same edges as the article's program.
const EDGES: [number, number][] = [
  [0, 1],
  [2, 3],
  [1, 3],
  [4, 5],
  [3, 0],
  [6, 7],
  [5, 6],
];

interface Step {
  parent: number[];
  /** Parent entries that changed in this step. */
  changed: number[];
  hot: number[];
  components: number;
  note: string;
}

export function dsuSteps(): Step[] {
  const parent = Array.from({ length: N }, (_, i) => i);
  const size = new Array(N).fill(1);
  let components = N;
  const steps: Step[] = [
    { parent: [...parent], changed: [], hot: [], components, note: `${N} elements, each its own group: parent[x] = x, so every element is a root.` },
  ];
  const find = (x: number, changed: number[]) => {
    while (parent[x] !== x) {
      const grand = parent[parent[x]];
      if (parent[x] !== grand) {
        parent[x] = grand; // path halving
        changed.push(x);
      }
      x = parent[x];
    }
    return x;
  };
  for (const [a, b] of EDGES) {
    const changed: number[] = [];
    const ra = find(a, changed);
    const rb = find(b, changed);
    const halving = changed.length ? ` Path halving re-pointed ${changed.map((x) => `${x} → ${parent[x]}`).join(', ')} on the way up.` : '';
    if (ra === rb) {
      steps.push({
        parent: [...parent],
        changed,
        hot: [a, b],
        components,
        note: `unite(${a}, ${b}): both finds reach root ${ra} — already connected, so this edge would close a cycle. Skip.${halving}`,
      });
      continue;
    }
    const [big, small] = size[ra] >= size[rb] ? [ra, rb] : [rb, ra];
    parent[small] = big;
    size[big] += size[small];
    components--;
    steps.push({
      parent: [...parent],
      changed: [...changed, small],
      hot: [a, b],
      components,
      note: `unite(${a}, ${b}): roots ${ra} and ${rb} differ. Hang root ${small} under root ${big}${size[big] - size[small] === size[small] ? ' (equal sizes: either way works)' : ' (smaller under larger)'} — ${components} groups left.${halving}`,
    });
  }
  return steps;
}

const STEPS = dsuSteps();

function rootOf(parent: number[], x: number): number {
  while (parent[x] !== x) x = parent[x];
  return x;
}

/** Group members by root, then by depth below the root. */
function groups(parent: number[]) {
  const byRoot = new Map<number, number[][]>();
  for (let x = 0; x < N; x++) {
    const r = rootOf(parent, x);
    let depth = 0;
    for (let y = x; parent[y] !== y; y = parent[y]) depth++;
    const levels = byRoot.get(r) ?? [];
    (levels[depth] ??= []).push(x);
    byRoot.set(r, levels);
  }
  return [...byRoot.entries()].sort((p, q) => p[0] - q[0]);
}

export default function DsuViz() {
  return (
    <VisualizationFrame
      title="Disjoint set union · union by size + path halving"
      steps={STEPS}
      interval={1800}
      stageMinHeight={250}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <div className={s.sets} role="img" aria-label={`${st.components} groups: ${groups(st.parent).map(([r, lv]) => `{${lv.flat().sort((p, q) => p - q).join(', ')}} rooted at ${r}`).join('; ')}`}>
            {groups(st.parent).map(([root, levels]) => (
              <div key={root} className={s.set} data-state={st.hot.some((h) => rootOf(st.parent, h) === root) ? 'hot' : undefined}>
                {levels.map((members, depth) => (
                  <div key={depth} className={s.level}>
                    {members.map((x) => (
                      <span
                        key={x}
                        className={s.node}
                        data-root={x === root}
                        data-state={st.changed.includes(x) ? 'changed' : st.hot.includes(x) ? 'hot' : undefined}
                      >
                        {x}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className={s.parentRow} aria-hidden="true">
            <span className={s.rowLabel} style={{ alignSelf: 'flex-end', paddingBottom: 6, width: 'auto' }}>
              parent
            </span>
            {st.parent.map((p, x) => (
              <span key={x} className={s.parentCell}>
                <span className={s.idx} style={{ width: 30 }}>{x}</span>
                <span className={s.cell} data-state={st.changed.includes(x) ? 'fresh' : undefined} style={{ textDecoration: 'none' }}>
                  {p}
                </span>
              </span>
            ))}
          </div>
          <div className={s.legend} aria-hidden="true">
            <span className={s.legendItem}><span className={s.swatch} data-state="current" /> root (ringed)</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="fresh" /> parent changed</span>
            <span className={`${s.legendItem} ${s.mono}`}>{st.components} groups</span>
          </div>
        </div>
      )}
    />
  );
}
