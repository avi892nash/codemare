'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Cells, Labels, Legend, Stage, vizStyles as s } from './parts';
import { bracketSteps } from './steps';

const INPUT = '{[()()]}(]';
const CHARS = [...INPUT];
const STEPS = bracketSteps(INPUT);

export default function BracketStackViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['bracket-stack'].title}
      steps={STEPS}
      interval={1100}
      stageMinHeight={230}
      describe={(st) => st.note}
      render={(st) => (
        <Stage>
          <Cells
            values={CHARS}
            state={(i) =>
              i === st.i ? (st.action === 'mismatch' ? 'err' : st.action === 'pop' ? 'ok' : 'active') : st.i !== null && i > st.i ? 'pending' : undefined
            }
          />
          <Labels n={CHARS.length} label={(i) => i} hot={(i) => i === st.i} />
          <div className={s.panel}>
            <span className={s.panelTitle}>stack (top ↑)</span>
            <div className={s.stack}>
              {st.stack.map((c, k) => {
                const top = k === st.stack.length - 1;
                const state = top ? (st.action === 'mismatch' || st.action === 'leftover' ? 'err' : st.action === 'push' ? 'active' : undefined) : undefined;
                return (
                  <span key={k} className={`${s.stackItem} mono`} data-state={state}>
                    {c}
                  </span>
                );
              })}
            </div>
          </div>
          <Legend items={[['active', 'pushed'], ['ok', 'matched'], ['err', 'mismatch']]} />
        </Stage>
      )}
    />
  );
}
