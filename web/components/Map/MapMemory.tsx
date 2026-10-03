'use client';

import { useEffect, useLayoutEffect } from 'react';

/** A layout effect where there is a browser (it runs before the first paint of a page that arrives from the router's cache), a plain one on the server. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

const ROWS = 'cm-map-open';
const SCROLL = 'cm-map-scroll';

/** The browser's Back and Forward buttons: this module outlives the page in the client bundle, so it hears the press that brings the map back. */
let lastTraversal = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    lastTraversal = Date.now();
  });
}
let firstMount = true;

/** Storage that is blocked (private mode, a policy) is no storage: nothing is remembered, nothing breaks. */
function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // blocked or full: forgotten
  }
}

/** What the learner has opened, by element id: a topic's row (`topic-…`) or a closed tier's panel (`tier-…`). */
function openedIds(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(ROWS) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** The disclosure an id names: the panel itself, or the one inside a topic's card. */
function disclosure(id: string): HTMLDetailsElement | null {
  const el = document.getElementById(id);
  if (el instanceof HTMLDetailsElement) return el;
  const inner = el?.querySelector(':scope > details');
  return inner instanceof HTMLDetailsElement ? inner : null;
}

/** The id a click on this summary is remembered under, or null for a disclosure that is none of the map's. */
function keyOf(summary: Element): string | null {
  const details = summary.parentElement;
  if (!(details instanceof HTMLDetailsElement)) return null;
  if (details.id.startsWith('tier-')) return details.id;
  const card = details.closest('article[data-card]');
  return card?.id.startsWith('topic-') ? card.id : null;
}

/** Is this page showing because of the Back or Forward button (a navigation inside the app, or a page the browser reloaded)? */
function cameBack(): boolean {
  const reload = firstMount && (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'back_forward';
  firstMount = false;
  return reload || Date.now() - lastTraversal < 2000;
}

/**
 * Keeps the map as the learner left it, for the length of the session
 * (sessionStorage — it is gone with the tab): which rows and panels they
 * opened, and how far down the page they were. The browser's Back button brings
 * the page back from the router's cache, rebuilt from the server's markup —
 * every row as the server left it, and the scroller (the page's own <main>, not
 * the window, so the router does not restore it) at the top — so a learner who
 * opened a row, opened a problem from it and went back found a different page.
 *
 * Rows are opened again, always, as the last step before the page is painted,
 * so nothing flashes shut and open; the scroll position only after Back or
 * Forward (a click on "Map" in the top bar is a new visit, from the top) and
 * never when the address names a place (<HashScroll> takes that).
 *
 * The server stays the source of what is open at first (the topic the hero is
 * about, the topic of the problem touched last); this only adds what the
 * learner opened, and forgets what they closed again. It records a learner's own
 * clicks on a summary — not a row a link opened (<HashScroll>) or the one an
 * unlock opened — so a link to a card does not leave that card open for the
 * rest of the session.
 */
export function MapMemory() {
  useBeforePaint(() => {
    for (const id of openedIds()) {
      const d = disclosure(id);
      if (d) d.open = true;
    }
    const back = cameBack();
    const main = document.querySelector('main');
    const top = Number(read(SCROLL));
    if (back && main && top > 0 && !window.location.hash) main.scrollTop = top;
  }, []);

  useEffect(() => {
    const main = document.querySelector('main');
    let frame = 0;
    // where this visit starts (the top, or where Back put it): what the next Back must restore is this visit's, not an earlier one's
    if (main) write(SCROLL, String(Math.round(main.scrollTop)));
    const onScroll = () => {
      if (frame || !main) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        write(SCROLL, String(Math.round(main.scrollTop)));
      });
    };
    const onClick = (e: MouseEvent) => {
      const summary = e.target instanceof Element ? e.target.closest('summary') : null;
      const key = summary ? keyOf(summary) : null;
      if (!summary || !key) return;
      const details = summary.parentElement as HTMLDetailsElement;
      // the browser flips `open` after this event: read the state it ends up in
      window.setTimeout(() => {
        const rest = openedIds().filter((id) => id !== key);
        write(ROWS, JSON.stringify(details.open ? [...rest, key] : rest));
      }, 0);
    };
    main?.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('click', onClick, true);
    return () => {
      main?.removeEventListener('scroll', onScroll);
      document.removeEventListener('click', onClick, true);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
