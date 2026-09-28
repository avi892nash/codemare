'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

// The article's graph: A..F, undirected, non-negative weights.
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];
const POS: [number, number][] = [
  [40, 110],
  [160, 40],
  [160, 180],
  [290, 40],
  [290, 180],
  [410, 110],
];
const EDGES: [number, number, number][] = [
  [0, 1, 4],
  [0, 2, 1],
  [2, 1, 2],
  [1, 3, 5],
  [2, 3, 8],
  [2, 4, 10],
  [3, 4, 2],
  [3, 5, 6],
  [4, 5, 3],
];
const INF = Number.POSITIVE_INFINITY;

interface Step {
  dist: number[];
  prev: number[];
  settled: boolean[];
  current: number | null;
  /** Edge indexes examined in this step. */
  examined: number[];
  /** Heap contents after this step, smallest first: [distance, vertex, stale]. */
  heap: [number, number, boolean][];
  note: string;
}

const adj: [number, number, number][][] = NAMES.map(() => []);
EDGES.forEach(([u, v, w], i) => {
  adj[u].push([v, w, i]);
  adj[v].push([u, w, i]);
});

export function dijkstraSteps(src = 0): Step[] {
  const n = NAMES.length;
  const dist = new Array(n).fill(INF);
  const prev = new Array(n).fill(-1);
  const settled = new Array(n).fill(false);
  let heap: [number, number][] = [[0, src]];
  dist[src] = 0;
  const snapshot = (): Step['heap'] =>
    [...heap].sort((p, q) => p[0] - q[0] || p[1] - q[1]).map(([d, v]) => [d, v, d !== dist[v] || settled[v]]);
  const steps: Step[] = [
    {
      dist: [...dist],
      prev: [...prev],
      settled: [...settled],
      current: null,
      examined: [],
      heap: snapshot(),
      note: `Start: d[${NAMES[src]}] = 0, every other distance is ∞. The heap holds (0, ${NAMES[src]}).`,
    },
  ];
  while (heap.length) {
    heap.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const [d, u] = heap.shift()!;
    if (d !== dist[u] || settled[u]) {
      steps.push({
        dist: [...dist],
        prev: [...prev],
        settled: [...settled],
        current: null,
        examined: [],
        heap: snapshot(),
        note: `Pop (${d}, ${NAMES[u]}): stale — ${NAMES[u]} was already settled at distance ${dist[u]}. Skip it.`,
      });
      continue;
    }
    settled[u] = true;
    const examined: number[] = [];
    const changes: string[] = [];
    for (const [v, w, i] of adj[u]) {
      if (settled[v]) continue;
      examined.push(i);
      if (dist[u] + w < dist[v]) {
        changes.push(`${NAMES[v]}: ${dist[v] === INF ? '∞' : dist[v]} → ${dist[u] + w}`);
        dist[v] = dist[u] + w;
        prev[v] = u;
        heap.push([dist[v], v]);
      } else {
        changes.push(`${NAMES[v]} stays ${dist[v]} (${dist[u]} + ${w} = ${dist[u] + w} is not shorter)`);
      }
    }
    steps.push({
      dist: [...dist],
      prev: [...prev],
      settled: [...settled],
      current: u,
      examined,
      heap: snapshot(),
      note: `Pop (${d}, ${NAMES[u]}): the smallest tentative distance, so d[${NAMES[u]}] = ${d} is final. ${
        changes.length ? `Relax its edges — ${changes.join('; ')}.` : 'Every neighbour is already settled.'
      }`,
    });
  }
  steps.push({
    dist: [...dist],
    prev: [...prev],
    settled: [...settled],
    current: null,
    examined: [],
    heap: [],
    note: `Heap empty: every distance is final. Green edges form the shortest-path tree from ${NAMES[src]}.`,
  });
  return steps;
}

const STEPS = dijkstraSteps();

function edgeState(i: number, st: Step): string | undefined {
  if (st.examined.includes(i)) return 'active';
  const [u, v] = EDGES[i];
  if ((st.prev[v] === u && st.settled[v]) || (st.prev[u] === v && st.settled[u])) return 'tree';
  return undefined;
}

export default function DijkstraViz() {
  return (
    <VisualizationFrame
      title="Dijkstra from A"
      steps={STEPS}
      interval={1900}
      stageMinHeight={290}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <svg
            className={s.svg}
            viewBox="0 0 450 230"
            role="img"
            aria-label={`Distances: ${NAMES.map((n, i) => `${n} ${st.dist[i] === INF ? 'infinity' : st.dist[i]}`).join(', ')}`}
          >
            {EDGES.map(([u, v, w], i) => {
              const [x1, y1] = POS[u];
              const [x2, y2] = POS[v];
              const mx = (x1 + x2) / 2;
              const my = (y1 + y2) / 2;
              return (
                <g key={i}>
                  <line className={s.edge} data-state={edgeState(i, st)} x1={x1} y1={y1} x2={x2} y2={y2} />
                  <rect className={s.edgeLabelBg} x={mx - 9} y={my - 9} width={18} height={18} rx={4} />
                  <text className={s.edgeLabel} x={mx} y={my + 4} textAnchor="middle">
                    {w}
                  </text>
                </g>
              );
            })}
            {NAMES.map((name, v) => {
              const [x, y] = POS[v];
              const queued = st.heap.some(([, hv, stale]) => hv === v && !stale);
              const state = st.current === v ? 'current' : st.settled[v] ? 'settled' : queued ? 'queued' : undefined;
              const above = y < 110;
              return (
                <g key={name}>
                  <circle className={s.vertex} data-state={state} cx={x} cy={y} r={17} />
                  <text className={s.vertexLabel} x={x} y={y}>
                    {name}
                  </text>
                  <text className={`${s.vertexSub} ${st.current === v ? s.vertexSubHot : ''}`} x={x} y={above ? y - 25 : y + 32}>
                    {st.dist[v] === INF ? '∞' : st.dist[v]}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className={s.panel}>
            <span className={s.key}>heap</span>
            <span className={s.chips}>
              {st.heap.length === 0 ? (
                <span className={s.valMuted}>empty</span>
              ) : (
                st.heap.map(([d, v, stale], i) => (
                  <span key={`${d}-${v}-${i}`} className={s.chip} data-state={stale ? 'stale' : i === 0 ? 'hot' : undefined}>
                    ({d}, {NAMES[v]})
                  </span>
                ))
              )}
            </span>
          </div>
          <div className={s.legend} aria-hidden="true">
            <span className={s.legendItem}><span className={s.swatch} data-state="current" /> popped now</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="done" /> settled</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="queue" /> in the heap</span>
          </div>
        </div>
      )}
    />
  );
}
