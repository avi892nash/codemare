'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { themeClassName, type Theme } from '@/lib/theme';
import { useMounted } from './hooks';

/**
 * Where overlays render. document.body by default; a Modal provides its own
 * layer so tooltips/menus opened inside it stay inside it (the rest of the
 * page is `inert` while a modal is open).
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

/**
 * The pinned theme of the closest <ThemeScope> around `el`, if any. Overlays
 * rendered into document.body use it so a tooltip opened inside a light
 * scope on a dark page is light too.
 */
export function scopedTheme(el: Element | null | undefined): Theme | null {
  const t = el?.closest('[data-theme]')?.getAttribute('data-theme');
  return t === 'light' || t === 'dark' ? t : null;
}

/**
 * Renders children into the current portal container after hydration (never
 * during SSR), inside a `display: contents` wrapper. With a `theme` the
 * wrapper becomes a theme scope so tokens resolve against that theme instead
 * of the page's. The wrapper is always there, so a theme resolved after the
 * first render only changes attributes — children are never remounted.
 */
export function Portal({ children, theme }: { children: ReactNode; theme?: Theme | null }) {
  const mounted = useMounted();
  const container = useContext(PortalContainerContext);
  if (!mounted) return null;
  return createPortal(
    <div
      data-theme={theme ?? undefined}
      className={theme ? themeClassName(theme) : undefined}
      style={theme ? { display: 'contents', color: 'var(--fg-0)' } : { display: 'contents' }}
    >
      {children}
    </div>,
    container ?? document.body,
  );
}
