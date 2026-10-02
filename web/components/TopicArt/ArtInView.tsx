'use client';

import { useEffect, useRef, type ReactNode } from 'react';

const loading = new Map<string, Promise<string>>();

/** Fetches a scene's svg once per URL (a failed fetch is forgotten, so the next visit to the card tries again). */
function loadScene(src: string): Promise<string> {
  let p = loading.get(src);
  if (!p) {
    p = fetch(src).then((res) => {
      if (!res.ok) throw new Error(`scene ${src}: ${res.status}`);
      return res.text();
    });
    p.catch(() => loading.delete(src));
    loading.set(src, p);
  }
  return p;
}

/**
 * Art that is already on the page, made to behave around the viewport:
 *
 *  - it animates only while it is (nearly) on screen: an IntersectionObserver
 *    sets `data-art-hold` once it has scrolled away and stage.module.css
 *    pauses every animation under it;
 *  - with `src`, the scene is not on the page at all (`<TopicArt lazy>` left
 *    an empty slot): the first time the art is near the viewport its svg is
 *    fetched from `src` (an immutable, content-versioned URL, so a return
 *    visit reads it from the cache) and put in the slot — whole, so the loop
 *    starts then, root included.
 *
 * The art itself is server-rendered and passed in as children, so this is
 * the only client JS the map's pictures need. The not-holding, not-loaded
 * state is what the server renders: nothing waits for hydration to start.
 */
export function ArtInView({ children, className, src }: { children: ReactNode; className?: string; src?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const slot = src ? el.querySelector<HTMLElement>('[data-lazy]') : null;
    let requested = false;
    const fill = () => {
      if (!slot || !src || requested || slot.hasChildNodes()) return;
      requested = true;
      loadScene(src).then(
        (svg) => {
          if (!slot.isConnected) return;
          slot.innerHTML = svg;
          slot.setAttribute('data-ready', '');
        },
        () => {
          requested = false;
        },
      );
    };
    if (typeof IntersectionObserver === 'undefined') {
      fill();
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        el.toggleAttribute('data-art-hold', !entry.isIntersecting);
        if (entry.isIntersecting) fill();
      },
      { rootMargin: '240px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
