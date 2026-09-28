'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Cells, Labels, Legend, Stage, vizStyles as s } from './parts';
import { binarySearchSteps } from './steps';

const A = [3, 9, 14, 20, 27, 31, 38, 45, 52, 60, 71, 88];
const TARGET = 52;
const STEPS = binarySearchSteps(A, TARGET);

export default function BinarySearchViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['binary-search'].title}
      steps={STEPS}
      interval={1300}
      describe={(st) => st.note}
      render={(st) => (
        <Stage>
          <div className={`${s.caption} mono`}>
            target = <b>{TARGET}</b> · candidates <b>{Math.max(0, st.hi - st.lo + 1)}</b>
          </div>
          <Cells
            values={A}
            state={(i) =>
              st.found === i ? 'ok' : st.mid === i ? 'active' : i < st.lo || i > st.hi ? 'dim' : 'window'
            }
          />
          <Labels n={A.length} label={(i) => i} />
          <Labels
            n={A.length}
            hot={(i) => i === st.mid}
            label={(i) =>
              st.lo > st.hi
                ? ''
                : [i === st.lo && 'lo', i === st.mid && 'mid', i === st.hi && 'hi'].filter(Boolean).join('·')
            }
          />
          <Legend items={[['window', 'still possible'], ['active', 'probe (mid)'], ['ok', 'found']]} />
        </Stage>
      )}
    />
  );
}
