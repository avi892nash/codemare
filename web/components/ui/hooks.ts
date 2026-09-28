'use client';

import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';

/** useLayoutEffect on the client, useEffect during SSR (avoids the warning). */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const noopSubscribe = () => () => {};

/**
 * False during SSR and hydration, true on the client afterwards — and true
 * on the very first render for anything mounted after hydration, so a portal
 * opened on demand renders in the same commit (focus management relies on it).
 */
export function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * Live `prefers-reduced-motion`. Returns false during SSR and the first client
 * render, then the real value — callers that autoplay should wait for
 * `useMounted()` before starting.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_MOTION);
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Selector for elements that can take keyboard focus. */
export const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getClientRects().length > 0,
  );
}
