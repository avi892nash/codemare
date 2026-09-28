import type { ReactNode } from 'react';
import s from './viz.module.css';

/* Small drawing primitives shared by the visualizations. The drawing is
 * aria-hidden: VisualizationFrame's narration (and the scrubber's
 * aria-valuetext) spells out every step for assistive tech. */

/** dim: ruled out · pending: not reached yet · active/window/ok/warn/err: tones · hole: empty slot. */
export type CellState = 'dim' | 'pending' | 'active' | 'window' | 'ok' | 'warn' | 'err' | 'hole' | undefined;

export function Cells({ values, state }: { values: ReadonlyArray<ReactNode>; state?: (i: number) => CellState }) {
  return (
    <div className={s.row}>
      {values.map((v, i) => (
        <span key={i} className={`${s.cell} mono`} data-state={state?.(i)}>
          {v}
        </span>
      ))}
    </div>
  );
}

/** A row of small labels aligned under the cells (indices, pointer names). */
export function Labels({ n, label, hot }: { n: number; label: (i: number) => ReactNode; hot?: (i: number) => boolean }) {
  return (
    <div className={s.labels}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`${s.label} mono`} data-hot={hot?.(i) || undefined}>
          {label(i)}
        </span>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: Array<[state: string, label: string]> }) {
  return (
    <div className={s.legend}>
      {items.map(([state, label]) => (
        <span key={label}>
          <span className={s.swatch} data-state={state} />
          {label}
        </span>
      ))}
    </div>
  );
}

export function Stage({ children }: { children: ReactNode }) {
  return (
    <div className={s.wrap} aria-hidden="true">
      {children}
    </div>
  );
}

export { s as vizStyles };
