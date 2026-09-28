'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';

const KEY = (name: string) => `cm:v1:split:${name}`;

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * A resizable split, as a percentage of its container, remembered per
 * browser. Returns the ratio and props for a WAI-ARIA window splitter
 * (role=separator, focusable, arrows / Home / End move it).
 */
export function useSplit(
  name: string,
  container: RefObject<HTMLElement>,
  opts: { initial: number; min: number; max: number; axis: 'x' | 'y'; label: string }
) {
  const { initial, min, max, axis, label } = opts;
  const [ratio, setRatio] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(KEY(name)));
      if (Number.isFinite(saved) && saved >= min && saved <= max) setRatio(saved);
    } catch {
      // storage unavailable — keep the default
    }
  }, [name, min, max]);

  const persist = useCallback(
    (v: number) => {
      try {
        window.localStorage.setItem(KEY(name), String(Math.round(v * 10) / 10));
      } catch {
        // ignore
      }
    },
    [name]
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const el = container.current;
      if (!el || e.button !== 0) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setDragging(true);
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      const move = (ev: globalThis.PointerEvent) => {
        const pct = axis === 'x' ? ((ev.clientX - rect.left) / rect.width) * 100 : ((ev.clientY - rect.top) / rect.height) * 100;
        setRatio(clamp(pct, min, max));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        setDragging(false);
        persist(ratioRef.current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [axis, container, max, min, persist]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const step = e.shiftKey ? 10 : 2;
      const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
      const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
      let next: number | null = null;
      if (e.key === back) next = ratioRef.current - step;
      else if (e.key === fwd) next = ratioRef.current + step;
      else if (e.key === 'Home') next = min;
      else if (e.key === 'End') next = max;
      else if (e.key === 'Enter') next = initial;
      if (next === null) return;
      e.preventDefault();
      const v = clamp(next, min, max);
      setRatio(v);
      persist(v);
    },
    [axis, initial, max, min, persist]
  );

  return {
    ratio,
    dragging,
    separatorProps: {
      role: 'separator' as const,
      tabIndex: 0,
      'aria-orientation': axis === 'x' ? ('vertical' as const) : ('horizontal' as const),
      'aria-label': label,
      'aria-valuemin': min,
      'aria-valuemax': max,
      'aria-valuenow': Math.round(ratio),
      'data-dragging': dragging || undefined,
      onPointerDown,
      onKeyDown,
      onDoubleClick: () => {
        setRatio(initial);
        persist(initial);
      },
    },
  };
}
