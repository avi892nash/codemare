'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Cells, Labels, Legend, Stage, vizStyles as s } from './parts';
import { coinChangeSteps } from './steps';

const COINS = [1, 3, 4];
const AMOUNT = 7;
const STEPS = coinChangeSteps(COINS, AMOUNT);

const show = (v: number | null) => (v === null ? '' : v === Number.POSITIVE_INFINITY ? '∞' : v);

export default function DpTableViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['dp-table'].title}
      steps={STEPS}
      interval={1100}
      describe={(st) => st.note}
      render={(st) => {
        const source = st.i !== null && st.coin !== null && st.coin <= st.i ? st.i - st.coin : null;
        return (
          <Stage>
            <div className={`${s.caption} mono`}>
              coins {'{'}
              {COINS.join(', ')}
              {'}'} · amount <b>{AMOUNT}</b>
              {st.i !== null && (
                <>
                  {' '}
                  · dp[{st.i}] best so far <b>{st.best ?? '—'}</b>
                </>
              )}
            </div>
            <Cells
              values={st.dp.map(show)}
              state={(x) =>
                x === st.i ? 'active' : x === source ? 'warn' : st.dp[x] === null ? 'dim' : x === AMOUNT && st.i === null && st.dp[x] !== null ? 'ok' : undefined
              }
            />
            <Labels n={AMOUNT + 1} label={(x) => x} hot={(x) => x === st.i} />
            <div className={s.chips}>
              {COINS.map((c) => (
                <span key={c} className={`${s.chip} mono`} data-state={st.coin === c ? 'active' : undefined}>
                  <span className={s.chipKey}>coin</span>
                  {c}
                </span>
              ))}
            </div>
            <Legend items={[['active', 'cell being filled'], ['warn', 'dp[x − coin] it reads']]} />
          </Stage>
        );
      }}
    />
  );
}
