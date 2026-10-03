'use client';

import { useEffect } from 'react';
import { MONACO_FILES } from './monacoFiles';

/**
 * Monaco comes from a CDN (the loader's default, jsDelivr, pinned to the
 * version @monaco-editor/loader names) and is the slowest thing on the problem
 * page: on a slow phone the first problem a device opens waits ~12 s for it,
 * every later one ~1 s, because the files are immutable and cached. So the page
 * a learner reads before their first problem — the map — warms the cache.
 *
 * Only DOWNLOADS: `<link rel="prefetch">` fetches at the lowest priority, into
 * the HTTP cache, and runs nothing, so it costs the page no main-thread time (an
 * early *start* of Monaco itself, which parses 3.6 MB of script, made the problem
 * page unresponsive for 13 s on the throttled profile). It begins once the page
 * has loaded and the browser is idle, and not at all on a data-saver or a 2G link.
 *
 * Which files: monacoFiles.ts.
 */
let started = false;

/** Renders nothing: warms the editor's files for the problem a learner opens next. */
export function EditorPrefetch() {
  useEffect(() => {
    if (started) return;
    const link = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (link?.saveData || /(^|-)2g$/.test(link?.effectiveType ?? '')) return;
    let cancelled = false;
    let idle = 0;
    const warm = () => {
      if (cancelled || started) return;
      started = true;
      for (const href of MONACO_FILES) {
        const el = document.createElement('link');
        el.rel = 'prefetch';
        el.as = href.endsWith('.css') ? 'style' : 'script';
        el.href = href;
        document.head.appendChild(el);
      }
    };
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(warm, { timeout: 4000 });
      else idle = window.setTimeout(warm, 1500);
    };
    if (document.readyState === 'complete') whenIdle();
    else window.addEventListener('load', whenIdle, { once: true });
    return () => {
      cancelled = true;
      window.removeEventListener('load', whenIdle);
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);
  return null;
}
