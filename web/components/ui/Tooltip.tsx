'use client';

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import type { Theme } from '@/lib/theme';
import { useIsomorphicLayoutEffect, useMounted } from './hooks';
import { Portal, scopedTheme } from './Portal';

type Side = 'top' | 'bottom';

interface TooltipProps {
  /** Short supplementary text. Never put the only label of a control here. */
  content: ReactNode;
  /** One focusable element (button, link…) that forwards aria-describedby. */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  side?: Side;
  /** Hover delay in ms; keyboard focus shows immediately. */
  delay?: number;
  disabled?: boolean;
}

const GAP = 6;
const MARGIN = 8;

/**
 * Hover + focus tooltip. The trigger gets `aria-describedby` pointing at the
 * role=tooltip bubble (kept mounted while hidden, so screen readers always
 * get the description). Meets WCAG 1.4.13: dismiss with Esc, hover the bubble
 * without it vanishing, stays until pointer/focus leaves. Rendered in a
 * portal (never clipped by scroll containers) and inherits a surrounding
 * <ThemeScope>.
 */
export function Tooltip({ content, children, side = 'top', delay = 350, disabled = false }: TooltipProps) {
  const id = useId();
  const mounted = useMounted();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null);

  const clear = () => window.clearTimeout(timer.current);
  const show = useCallback((immediate: boolean) => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    const go = () => {
      setTheme(scopedTheme(wrapRef.current?.firstElementChild));
      setOpen(true);
    };
    if (immediate) go();
    else timer.current = window.setTimeout(go, delay);
  }, [delay, disabled]);
  const hide = useCallback((after = 0) => {
    window.clearTimeout(timer.current);
    if (after) timer.current = window.setTimeout(() => setOpen(false), after);
    else setOpen(false);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Measure and place before paint; follow scroll/resize while open.
  useIsomorphicLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const t = wrapRef.current?.firstElementChild;
      const b = bubbleRef.current;
      if (!t || !b) return;
      const r = t.getBoundingClientRect();
      const bw = b.offsetWidth;
      const bh = b.offsetHeight;
      let s: Side = side;
      if (s === 'top' && r.top - bh - GAP < MARGIN) s = 'bottom';
      else if (s === 'bottom' && r.bottom + bh + GAP > window.innerHeight - MARGIN) s = 'top';
      const top = s === 'top' ? r.top - bh - GAP : r.bottom + GAP;
      const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - MARGIN);
      setPos({ top, left, side: s });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const describedBy = [children.props['aria-describedby'], mounted && !disabled ? id : null]
    .filter(Boolean)
    .join(' ') || undefined;

  return (
    <>
      <span
        ref={wrapRef}
        style={{ display: 'contents' }}
        onMouseEnter={() => show(false)}
        onMouseLeave={() => hide(120)}
        onFocus={(e) => {
          // Only keyboard-style focus; a mouse click already hovered.
          if ((e.target as HTMLElement).matches?.(':focus-visible')) show(true);
        }}
        onBlur={() => hide()}
        onMouseDown={() => hide()}
      >
        {cloneElement(children, { 'aria-describedby': describedBy })}
      </span>
      {!disabled && (
        <Portal theme={theme}>
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            onMouseEnter={clear}
            onMouseLeave={() => hide(80)}
            style={{
              display: open ? 'block' : 'none',
              position: 'fixed',
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? 'visible' : 'hidden',
              zIndex: 1000,
              maxWidth: 260,
              padding: '5px 8px',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-xs)',
              fontWeight: 500,
              lineHeight: 1.4,
              color: 'var(--fg-0)',
              background: 'var(--bg-3)',
              borderRadius: 'var(--r)',
              boxShadow: 'var(--shadow)',
              pointerEvents: 'auto',
              animation: 'cm-fade-in .1s ease-out',
            }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}
