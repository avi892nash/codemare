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
