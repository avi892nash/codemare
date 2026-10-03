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
 * How the solving workspace is laid out right now — keep in step with the media queries in Workspace.module.css:
 *  - wide: from 1024 px, statement | editor over console, all at once;
 *  - tablet: 768–1023 px wide and at least 600 px tall (an iPad upright): two panes, the problem, and the editor over the
 *    console, so a result is read with the code in view;
 *  - phone: anything narrower, or short (a phone on its side): one pane at a time — Problem · Code · Result.
 */
export type WorkspaceLayout = 'wide' | 'tablet' | 'phone';
const TABLET = '(min-width: 768px) and (max-width: 1023px) and (min-height: 600px)';
const NARROW = '(max-width: 1023px)';

export function layoutNow(): WorkspaceLayout {
  if (window.matchMedia(TABLET).matches) return 'tablet';
  return window.matchMedia(NARROW).matches ? 'phone' : 'wide';
}

/** The workspace's layout, kept current as the window changes. Starts wide (what the server renders) and corrects itself after mount. */
export function useLayout(): WorkspaceLayout {
  const [layout, setLayout] = useState<WorkspaceLayout>('wide');
  useEffect(() => {
    const queries = [window.matchMedia(TABLET), window.matchMedia(NARROW)];
    const update = () => setLayout(layoutNow());
    update();
    for (const q of queries) q.addEventListener('change', update);
    return () => {
      for (const q of queries) q.removeEventListener('change', update);
    };
  }, []);
  return layout;
}
