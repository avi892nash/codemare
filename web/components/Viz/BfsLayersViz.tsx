'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Legend, Stage, vizStyles as s } from './parts';
import { BFS_GRAPH, bfsSteps, type BfsStep } from './steps';

const STEPS = bfsSteps(BFS_GRAPH, 'A');
const POS = new Map(BFS_GRAPH.nodes.map((n) => [n.id, n]));
const R = 16;

const sameEdge = (e: [string, string], a: string, b: string) => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a);

function edgeState(st: BfsStep, a: string, b: string) {
  if (st.edge && sameEdge([st.edge.from, st.edge.to], a, b)) return st.edge.discovered ? 'active' : 'skip';
  return st.tree.some((e) => sameEdge(e, a, b)) ? 'tree' : undefined;
}

function nodeState(st: BfsStep, id: string) {
  if (st.current === id) return 'current';
  if (st.done.includes(id)) return 'done';
  if (st.queue.includes(id)) return 'queued';
  return undefined;
}

export default function BfsLayersViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['bfs-layers'].title}
      steps={STEPS}
      interval={1300}
      stageMinHeight={260}
      describe={(st) => st.note}
      render={(st) => (
        <Stage>
          <svg className={s.svg} viewBox="0 0 350 205" role="presentation">
            {BFS_GRAPH.edges.map(([a, b]) => {
              const p = POS.get(a)!;
              const q = POS.get(b)!;
              return <line key={`${a}${b}`} className={s.edge} data-state={edgeState(st, a, b)} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />;
            })}
            {BFS_GRAPH.nodes.map((n) => (
              <g key={n.id}>
                <circle className={s.node} data-state={nodeState(st, n.id)} cx={n.x} cy={n.y} r={R} />
                <text className={`${s.nodeText} mono`} x={n.x} y={n.y}>
                  {n.id}
                </text>
                <text className={`${s.nodeSub} mono`} x={n.x} y={n.y + R + 12}>
                  {st.dist[n.id] === undefined ? '' : `d=${st.dist[n.id]}`}
                </text>
              </g>
            ))}
          </svg>
          <div className={s.panel}>
            <span className={s.panelTitle}>queue (front → back)</span>
            <div className={s.chips}>
              {st.queue.length === 0 ? (
                <span className={s.empty}>empty</span>
              ) : (
                st.queue.map((id, k) => (
                  <span key={id} className={`${s.chip} mono`} data-state={k === 0 ? 'active' : undefined}>
                    {id}
                    <span className={s.chipKey}>d={st.dist[id]}</span>
                  </span>
                ))
              )}
            </div>
          </div>
          <Legend items={[['active', 'dequeued now'], ['queued', 'in the queue'], ['ok', 'finished']]} />
        </Stage>
      )}
    />
  );
}
