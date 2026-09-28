'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Cells, Labels, Legend, Stage, vizStyles as s } from './parts';
import { twoPointerSteps } from './steps';

const A = [1, 3, 4, 6, 8, 11, 15];
const TARGET = 10;
const STEPS = twoPointerSteps(A, TARGET);

export default function TwoPointersViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['two-pointers'].title}
      steps={STEPS}
      interval={1400}
      describe={(st) => st.note}
      render={(st) => (
        <Stage>
          <div className={`${s.caption} mono`}>
            target = <b>{TARGET}</b>
            {st.sum !== null && (
              <>
                {' '}· a[l] + a[r] = <b>{st.sum}</b> {st.sum === TARGET ? '=' : st.sum > TARGET ? '>' : '<'} {TARGET}
              </>
            )}
          </div>
          <Cells
            values={A}
            state={(i) => {
              if (st.done === 'found' && (i === st.l || i === st.r)) return 'ok';
              if (i === st.l || i === st.r) return st.done === 'none' ? 'dim' : 'active';
              return i < st.l || i > st.r ? 'dim' : undefined;
            }}
          />
          <Labels n={A.length} label={(i) => i} />
          <Labels
            n={A.length}
            hot={(i) => i === st.l || i === st.r}
            label={(i) => [i === st.l && 'l', i === st.r && 'r'].filter(Boolean).join('·')}
          />
          <Legend items={[['active', 'pointers'], ['ok', 'pair found']]} />
        </Stage>
      )}
    />
  );
}
