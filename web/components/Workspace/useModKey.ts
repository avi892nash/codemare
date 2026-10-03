'use client';

import { useEffect, useState } from 'react';

/**
 * The shortcut modifier to print: "⌘" on Apple platforms, "Ctrl " elsewhere.
 * Starts as "⌘" (what the server renders) and corrects itself after mount.
 */
export function useModKey(): string {
  const [mod, setMod] = useState('⌘');
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
    if (!/mac|iphone|ipad|ipod/i.test(platform)) setMod('Ctrl ');
  }, []);
  return mod;
}

/**
 * True on a touch-only device (a phone or tablet with no mouse, `(hover: none)`),
 * where "⌘↵" printed on a button is noise nobody can press. Starts false (what
 * the server renders) and corrects itself after mount.
 */
export function useTouchOnly(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(hover: none)');
    setTouch(query.matches);
    const onChange = (e: MediaQueryListEvent) => setTouch(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return touch;
}

/**
 * True below 1024 px, where the workspace shows one pane at a time (Problem · Code · Result) — the same breakpoint as
 * Workspace.module.css. Starts false (what the server renders) and corrects itself after mount.
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    setNarrow(query.matches);
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}
