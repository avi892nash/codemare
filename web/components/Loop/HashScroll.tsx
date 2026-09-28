'use client';

import { useEffect } from 'react';

/**
 * Scrolls to the URL's #fragment once the page has rendered. A hard load of
 * `/map#tier-…` can miss it: the page streams in after the browser's own
 * attempt, inside the layout's scrolling <main>.
 */
export function HashScroll() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);
  return null;
}
