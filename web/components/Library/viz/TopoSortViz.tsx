'use client';

import { useId } from 'react';
import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import s from './viz.module.css';

// The article's build pipeline: (a, b) means a must happen before b.
const TASKS = ['fetch', 'parse', 'lint', 'typecheck', 'bundle', 'test', 'deploy'];
const DEPS: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 3],
  [3, 4],
  [2, 5],
  [3, 5],
  [4, 6],
  [5, 6],
];
const POS: [number, number][] = [
  [52, 110],
  [162, 110],
  [284, 50],
  [284, 170],
  [406, 170],
  [406, 50],
  [516, 110],
];
const HW = 46;
const HH = 15;

interface Step {
  indegree: number[];
  removed: boolean[]; // per edge
  queue: number[];
  order: number[];
  current: number | null;
  note: string;
}

export function topoSteps(): Step[] {
  const n = TASKS.length;
  const indegree = new Array(n).fill(0);
  for (const [, b] of DEPS) indegree[b]++;
  const removed = DEPS.map(() => false);
  const queue = TASKS.map((_, v) => v).filter((v) => indegree[v] === 0);
  const order: number[] = [];
  const steps: Step[] = [
    {
      indegree: [...indegree],
      removed: [...removed],
      queue: [...queue],
      order: [],
      current: null,
      note: `Count incoming edges. Only ${queue.map((v) => TASKS[v]).join(', ')} has in-degree 0 — nothing must happen before it — so it starts the queue.`,
    },
  ];
  while (queue.length) {
    const u = queue.shift()!;
    order.push(u);
    const freed: number[] = [];
    DEPS.forEach(([a, b], i) => {
      if (a !== u) return;
      removed[i] = true;
      if (--indegree[b] === 0) {
        queue.push(b);
        freed.push(b);
      }
    });
    const outs = DEPS.filter(([a]) => a === u).map(([, b]) => TASKS[b]);
    steps.push({
      indegree: [...indegree],
      removed: [...removed],
      queue: [...queue],
      order: [...order],
      current: u,
      note: `Take ${TASKS[u]} (position ${order.length}). ${
        outs.length ? `Remove its edges to ${outs.join(', ')}. ` : 'It has no outgoing edges. '
      }${freed.length ? `${freed.map((v) => TASKS[v]).join(' and ')} now ${freed.length === 1 ? 'has' : 'have'} in-degree 0 and join${freed.length === 1 ? 's' : ''} the queue.` : 'No new vertex becomes free.'}`,
    });
  }
  steps.push({
    indegree: [...indegree],
    removed: [...removed],
    queue: [],
    order: [...order],
    current: null,
    note: `The queue is empty and all ${order.length} tasks are placed, so there is no cycle. Every edge points forward in this order.`,
  });
  return steps;
}

const STEPS = topoSteps();

/** Where the segment from a's centre towards b leaves a's box. */
function boxExit([x1, y1]: [number, number], [x2, y2]: [number, number]): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.min(dx ? HW / Math.abs(dx) : Infinity, dy ? HH / Math.abs(dy) : Infinity);
  return [x1 + dx * t, y1 + dy * t];
}

export default function TopoSortViz() {
  const markerId = `arrow-${useId().replace(/:/g, '')}`;
  return (
    <VisualizationFrame
      title="Kahn's algorithm · build order"
      steps={STEPS}
      interval={1800}
      stageMinHeight={290}
      describe={(st) => st.note}
      render={(st) => (
        <div className={s.wrap}>
          <svg
            className={s.svg}
            viewBox="0 0 568 220"
            style={{ maxWidth: 568 }}
            role="img"
            aria-label={`Order so far: ${st.order.map((v) => TASKS[v]).join(', ') || 'empty'}; queue: ${st.queue.map((v) => TASKS[v]).join(', ') || 'empty'}`}
          >
            <defs>
              <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path className={s.arrow} d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {DEPS.map(([a, b], i) => {
              const [x1, y1] = boxExit(POS[a], POS[b]);
              const [x2, y2] = boxExit(POS[b], POS[a]);
              return (
                <line
                  key={i}
                  className={s.edge}
                  data-state={st.removed[i] ? 'removed' : undefined}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  markerEnd={`url(#${markerId})`}
                />
              );
            })}
            {TASKS.map((task, v) => {
              const [x, y] = POS[v];
              const state = st.current === v ? 'current' : st.order.includes(v) ? 'done' : st.queue.includes(v) ? 'queued' : undefined;
              return (
                <g key={task}>
                  <rect className={s.vertex} data-state={state} x={x - HW} y={y - HH} width={HW * 2} height={HH * 2} rx={8} />
                  <text className={s.taskLabel} x={x} y={y}>
                    {task}
                  </text>
                  {!st.order.includes(v) && (
                    <g>
                      <circle className={s.badge} cx={x + HW - 2} cy={y - HH} r={8} />
                      <text className={s.badgeText} x={x + HW - 2} y={y - HH}>
                        {st.indegree[v]}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          <div className={s.panel}>
            <span className={s.key}>queue</span>
            <span className={s.chips}>
              {st.queue.length ? st.queue.map((v, i) => <span key={v} className={s.chip} data-state={i === 0 ? 'hot' : undefined}>{TASKS[v]}</span>) : <span className={s.valMuted}>empty</span>}
            </span>
            <span className={s.key}>order</span>
            <span className={s.chips}>
              {st.order.length ? st.order.map((v, i) => <span key={v} className={s.chip} data-state="done">{i + 1}. {TASKS[v]}</span>) : <span className={s.valMuted}>—</span>}
            </span>
          </div>
          <div className={s.legend} aria-hidden="true">
            <span className={s.legendItem}><span className={s.swatch} data-state="queue" /> in the queue</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="current" /> taken now</span>
            <span className={s.legendItem}><span className={s.swatch} data-state="done" /> placed</span>
            <span className={s.legendItem}>badge = remaining in-degree</span>
          </div>
        </div>
      )}
    />
  );
}
