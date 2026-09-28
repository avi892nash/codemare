'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import s from './profile.module.css';

export interface HeatDay {
  day: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ROW_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const STEP = 14; // cell 11px + gap 3px

/** Deterministic (server = client) long date for a UTC `YYYY-MM-DD`. */
function longDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

export function describeDay(d: HeatDay): string {
  const n = d.count === 0 ? 'No submissions' : `${d.count} submission${d.count === 1 ? '' : 's'}`;
  return `${n} on ${longDate(d.day)}`;
}

type Pos = { w: number; d: number };

/**
 * 365-day activity heatmap (weeks as columns, Sunday on top). It is an ARIA
 * grid: every day cell is labelled with its count and date, one cell is in
 * the tab order (roving tabindex), and ←/→ move a week, ↑/↓ a day,
 * Home/End to the ends of the row, Ctrl+Home/End to the first/last day.
 * The focused or hovered day is also spelled out under the grid.
 */
export function ActivityHeatmap({ weeks, total, activeDays }: { weeks: Array<Array<HeatDay | null>>; total: number; activeDays: number }) {
  const labelId = useId();
  const cells = useRef(new Map<string, HTMLDivElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const last = useMemo<Pos>(() => {
    for (let w = weeks.length - 1; w >= 0; w--) for (let d = 6; d >= 0; d--) if (weeks[w]?.[d]) return { w, d };
    return { w: 0, d: 0 };
  }, [weeks]);
  const [focus, setFocus] = useState<Pos>(last);
  const [shown, setShown] = useState<HeatDay | null>(null);

  // Start scrolled to the most recent weeks on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  const at = (p: Pos) => weeks[p.w]?.[p.d] ?? null;

  const go = (p: Pos) => {
    const day = at(p);
    if (!day) return;
    setFocus(p);
    setShown(day);
    cells.current.get(`${p.w}:${p.d}`)?.focus();
  };

  /** Step in a direction, skipping padding cells, stopping at the edges. */
  const step = (dw: number, dd: number) => {
    let p = { w: focus.w + dw, d: focus.d + dd };
    while (p.w >= 0 && p.w < weeks.length && p.d >= 0 && p.d < 7) {
      if (at(p)) return go(p);
      p = { w: p.w + dw, d: p.d + dd };
    }
  };

  const edge = (dir: 1 | -1, row: number | null) => {
    const order = dir === 1 ? [...weeks.keys()].reverse() : [...weeks.keys()];
    for (const w of order) {
      const rows = row === null ? (dir === 1 ? [6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6]) : [row];
      for (const d of rows) if (weeks[w]?.[d]) return go({ w, d });
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => step(-1, 0),
      ArrowRight: () => step(1, 0),
      ArrowUp: () => step(0, -1),
      ArrowDown: () => step(0, 1),
      Home: () => edge(-1, e.ctrlKey || e.metaKey ? null : focus.d),
      End: () => edge(1, e.ctrlKey || e.metaKey ? null : focus.d),
    };
    const fn = keys[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  };

  // Month labels over the week in which each month starts.
  // A month is labelled over the week holding its 1st; the partial first
  // week only gets a label when the next month starts well after it.
  const starts: { w: number; label: string }[] = [];
  weeks.forEach((week, w) => {
    const first = week.find((d): d is HeatDay => !!d);
    if (!first) return;
    if (w === 0 || Number(first.day.slice(8, 10)) <= 7) {
      const monthDay = week.find((d) => d && Number(d.day.slice(8, 10)) === 1) ?? first;
      starts.push({ w, label: MONTHS[Number(monthDay.day.slice(5, 7)) - 1].slice(0, 3) });
    }
  });
  const months = starts.filter((m, i) => i + 1 >= starts.length || starts[i + 1].w - m.w >= 3);

  const summary = `${total.toLocaleString('en-US')} submission${total === 1 ? '' : 's'} in the last year, on ${activeDays} day${activeDays === 1 ? '' : 's'}`;

  return (
    <div className={s.heat}>
      <div className={`${s.heatScroll} scroll`} ref={scroller}>
        <div className={s.heatInner}>
          <span />
          <div className={s.months} aria-hidden="true" style={{ width: weeks.length * STEP }}>
            {months.map((m) => (
              <span key={`${m.w}-${m.label}`} style={{ left: m.w * STEP }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className={s.weekdays} aria-hidden="true">
            {ROW_LABELS.map((l, i) => (
              <span key={i}>{l}</span>
            ))}
          </div>
          <div
            role="grid"
            aria-labelledby={labelId}
            aria-readonly="true"
            className={s.grid}
            onKeyDown={onKeyDown}
            onMouseLeave={() => setShown(null)}
          >
            {Array.from({ length: 7 }, (_, d) => (
              <div role="row" key={d} className={s.gridRow} aria-label={WEEKDAYS[d]}>
                {weeks.map((week, w) => {
                  const day = week[d];
                  if (!day) return <div key={w} role="gridcell" className={s.cell} data-pad="true" />;
                  const isFocus = focus.w === w && focus.d === d;
                  return (
                    <div
                      key={w}
                      ref={(el) => {
                        if (el) cells.current.set(`${w}:${d}`, el);
                        else cells.current.delete(`${w}:${d}`);
                      }}
                      role="gridcell"
                      tabIndex={isFocus ? 0 : -1}
                      aria-label={describeDay(day)}
                      className={s.cell}
                      data-level={day.level}
                      onFocus={() => {
                        setFocus({ w, d });
                        setShown(day);
                      }}
                      onMouseEnter={() => setShown(day)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className={s.heatFoot}>
        <span id={labelId}>{summary}</span>
        <span className={s.legend} aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className={s.cell} data-level={l} />
          ))}
          More
        </span>
      </div>
      {/* Visual echo of the focused/hovered cell; its label already reaches screen readers. */}
      <div className={`${s.focusLine} mono`} aria-hidden="true" style={{ fontSize: 12, marginTop: 6 }}>
        {shown ? describeDay(shown) : ''}
      </div>
    </div>
  );
}
