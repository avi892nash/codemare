'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Cells, Labels, Legend, Stage, vizStyles as s } from './parts';
import { heapSteps, parentOf } from './steps';

const STEPS = heapSteps([7, 4, 9, 2, 5, 1], 1);
const R = 15;
const W = 320;

/** x/y of heap index i in a complete binary tree drawing. */
function pos(i: number) {
  const level = Math.floor(Math.log2(i + 1));
  const first = 2 ** level - 1;
  const slots = 2 ** level;
  return { x: ((i - first + 0.5) / slots) * W, y: 22 + level * 52 };
}

export default function HeapViz() {
  return (
    <VisualizationFrame
      title={VIZ_META.heap.title}
      steps={STEPS}
      interval={1200}
      stageMinHeight={270}
      describe={(st) => st.note}
      render={(st) => (
        <Stage>
          <div className={`${s.caption} mono`}>
            size <b>{st.heap.length}</b>
            {st.removed !== null && (
              <>
                {' '}· popped <b>{st.removed}</b>
              </>
            )}
          </div>
          <svg className={s.svg} viewBox={`0 0 ${W} 150`} role="presentation">
            {st.heap.map((_, i) => {
              if (i === 0) return null;
              const a = pos(parentOf(i));
              const b = pos(i);
              const hot = (st.active === i && st.compare === parentOf(i)) || (st.compare === i && st.active === parentOf(i));
              return <line key={`e${i}`} className={s.edge} data-state={hot ? 'active' : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
            })}
            {st.heap.map((v, i) => {
              const p = pos(i);
              return (
                <g key={`n${i}`}>
                  <circle
                    className={s.node}
                    data-state={i === st.active ? 'current' : i === st.compare ? 'compare' : undefined}
                    cx={p.x}
                    cy={p.y}
                    r={R}
                  />
                  <text className={`${s.nodeText} mono`} x={p.x} y={p.y}>
                    {v}
                  </text>
                </g>
              );
            })}
          </svg>
          {st.heap.length > 0 ? (
            <>
              <Cells values={st.heap} state={(i) => (i === st.active ? 'active' : i === st.compare ? 'warn' : undefined)} />
              <Labels n={st.heap.length} label={(i) => i} />
            </>
          ) : (
            <span className={s.empty}>empty heap</span>
          )}
          <Legend items={[['active', 'moving value'], ['warn', 'compared with']]} />
        </Stage>
      )}
    />
  );
}
