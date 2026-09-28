'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Labels, Legend, Stage, vizStyles as s } from './parts';
import { insertionSortSteps } from './steps';

const INPUT = [5, 2, 8, 4, 7, 1, 6];
const MAX = Math.max(...INPUT);
const STEPS = insertionSortSteps(INPUT);

export default function InsertionSortViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['insertion-sort'].title}
      steps={STEPS}
      interval={1000}
      stageMinHeight={220}
      describe={(st) => st.note}
      render={(st) => (
        <Stage>
          <div className={`${s.held} mono`}>
            key{' '}
            <span className={`${s.cell}`} data-state={st.key === null ? 'hole' : 'active'} style={{ width: 34 }}>
              {st.key ?? ''}
            </span>
          </div>
          <div className={s.bars}>
            {st.a.map((v, i) => {
              const state = v === null ? 'hole' : i === st.compare ? 'warn' : i < st.sorted ? 'sorted' : undefined;
              const h = v === null ? (st.key ?? 0) : v;
              return (
                <div key={i} className={s.barCol}>
                  <span className={`${s.barValue} mono`}>{v ?? ''}</span>
                  <div className={s.bar} data-state={state} style={{ height: `${Math.max(8, (h / MAX) * 92)}px` }} />
                </div>
              );
            })}
          </div>
          <Labels n={st.a.length} label={(i) => i} hot={(i) => i === st.hole} />
          <Legend items={[['ok', 'sorted prefix'], ['warn', 'compared with key'], ['active', 'key in hand']]} />
        </Stage>
      )}
    />
  );
}
