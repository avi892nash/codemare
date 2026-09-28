'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Cells, Labels, Legend, Stage, vizStyles as s } from './parts';
import { hashMapSteps } from './steps';

const NUMS = [4, 9, 1, 12, 6, 3];
const TARGET = 9;
const STEPS = hashMapSteps(NUMS, TARGET);

export default function HashMapViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['hash-map'].title}
      steps={STEPS}
      interval={1300}
      describe={(st) => st.note}
      render={(st) => (
        <Stage>
          <div className={`${s.caption} mono`}>
            target = <b>{TARGET}</b>
            {st.lookup && (
              <>
                {' '}· need <b>{st.lookup.key}</b> → {st.lookup.hit ? 'in the map' : 'not in the map'}
              </>
            )}
          </div>
          <Cells
            values={NUMS}
            state={(i) => (st.answer?.includes(i) ? 'ok' : i === st.i ? 'active' : st.i !== null && i > st.i ? 'dim' : undefined)}
          />
          <Labels n={NUMS.length} label={(i) => i} hot={(i) => i === st.i} />
          <div className={s.panel}>
            <span className={s.panelTitle}>map: value → index</span>
            <div className={s.chips}>
              {st.map.length === 0 ? (
                <span className={s.empty}>empty</span>
              ) : (
                st.map.map(([k, v]) => (
                  <span
                    key={k}
                    className={`${s.chip} mono`}
                    data-state={st.lookup?.key === k ? (st.lookup.hit ? 'ok' : undefined) : undefined}
                  >
                    {k}
                    <span className={s.chipKey}>→ {v}</span>
                  </span>
                ))
              )}
            </div>
          </div>
          <Legend items={[['active', 'current element'], ['ok', 'the pair']]} />
        </Stage>
      )}
    />
  );
}
