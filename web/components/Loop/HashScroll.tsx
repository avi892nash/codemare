'use client';

import { useEffect } from 'react';

/** The element a `#fragment` names, or null (a malformed fragment is no element). */
function target(hash: string): HTMLElement | null {
  try {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    return id ? document.getElementById(id) : null;
  } catch {
    return null;
  }
}

/**
 * Makes `el` visible: opens every collapsed <details> that holds it (a closed
 * tier's panel, a topic's list), and, when `el` is a topic's card, the card's
 * own disclosure too — a link to a card means "show me it".
 */
function reveal(el: HTMLElement): void {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n instanceof HTMLDetailsElement) n.open = true;
  }
  if (el.hasAttribute('data-card')) el.querySelector<HTMLDetailsElement>(':scope > details')?.setAttribute('open', '');
}

/**
 * Takes a `#fragment` to what it names on the map once the page has rendered:
 * a hard load of `/map#tier-…` can miss it (the page streams in after the
 * browser's own attempt, inside the layout's scrolling <main>), and what it
 * names may sit in a collapsed panel the browser would not open. So it opens
 * what must be opened, then scrolls — on load, when the fragment changes, and
 * when an in-page link is clicked (a <Link> to a fragment changes the URL
 * without a `hashchange`, so the click opens the target before the router
 * scrolls to it).
 */
export function HashScroll() {
  useEffect(() => {
    const go = () => {
      const el = target(window.location.hash);
      if (!el) return;
      reveal(el);
      el.scrollIntoView({ block: 'start' });
    };
    const onClick = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
      const el = link ? target(link.getAttribute('href') ?? '') : null;
      if (el) reveal(el);
    };
    go();
    window.addEventListener('hashchange', go);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('hashchange', go);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  return null;
}
