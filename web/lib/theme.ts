/**
 * Theme plumbing shared by the server (root layout reads the cookie so SSR
 * renders the right class — no flash) and the client (ThemeProvider writes
 * the cookie and flips the class without a reload).
 *
 * Dark (`.cm`) is the default; light adds `.cm-light`. Pure module: no
 * next/headers or DOM imports, so both sides can use it.
 */

export type Theme = 'dark' | 'light';

export const THEMES: readonly Theme[] = ['dark', 'light'] as const;

/** Cookie that persists the choice. Read by app/layout.tsx. */
export const THEME_COOKIE = 'cm-theme';

export const DEFAULT_THEME: Theme = 'dark';

/** One year — the choice should outlive sessions. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseTheme(value: string | null | undefined): Theme {
  return value === 'light' ? 'light' : DEFAULT_THEME;
}

/** Class list for the element that carries the theme (html, or a scope). */
export function themeClassName(theme: Theme): string {
  return theme === 'light' ? 'cm cm-light' : 'cm';
}

/** `document.cookie` assignment string for the given theme. */
export function themeCookieString(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}
