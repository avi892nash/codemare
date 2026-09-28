'use client';

import { VisualizationFrame } from '@/components/ui/VisualizationFrame';
import { VIZ_META } from './ids';
import { Cells, Labels, Legend, Stage, vizStyles as s } from './parts';
import { slidingWindowSteps } from './steps';

const S = 'abcbdeab';
const CHARS = [...S];
const STEPS = slidingWindowSteps(S);
const LAST = STEPS.length - 1;

export default function SlidingWindowViz() {
  return (
    <VisualizationFrame
      title={VIZ_META['sliding-window'].title}
      steps={STEPS}
      interval={1200}
      describe={(st) => st.note}
      render={(st, index) => {
        const inWindow = (i: number) => i >= st.l && i <= st.r;
        const final = index === LAST;
        return (
          <Stage>
            <div className={`${s.caption} mono`}>
              window length <b>{Math.max(0, st.r - st.l + 1)}</b> · best{' '}
              <b>{st.best ? `"${CHARS.slice(st.best.l, st.best.r + 1).join('')}"` : '—'}</b>
            </div>
            <Cells
              values={CHARS}
              state={(i) => {
                if (final) return inWindow(i) ? 'ok' : 'dim';
                if (st.focus?.i === i) return st.focus.kind === 'add' ? 'active' : st.focus.kind === 'clash' ? 'err' : 'warn';
                return inWindow(i) ? 'window' : 'dim';
              }}
            />
            <Labels n={CHARS.length} label={(i) => i} />
            <Labels
              n={CHARS.length}
              hot={(i) => i === st.l || i === st.r}
              label={(i) => (st.r < st.l ? (i === st.l ? 'l' : '') : [i === st.l && 'l', i === st.r && 'r'].filter(Boolean).join('·'))}
            />
            <div className={s.panel}>
              <span className={s.panelTitle}>in the window</span>
              <div className={s.chips}>
                {st.window.length === 0 ? (
                  <span className={s.empty}>empty</span>
                ) : (
                  st.window.map((c, k) => (
                    <span key={`${c}-${k}`} className={`${s.chip} mono`}>
                      {c}
                    </span>
                  ))
                )}
              </div>
            </div>
            <Legend items={[['window', 'window'], ['active', 'added'], ['warn', 'removed']]} />
          </Stage>
        );
      }}
    />
  );
}
