'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, themeCookieString, type Theme } from '@/lib/theme';

export interface ThemeContextValue {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Flip the root classes and persist the choice. Safe to call repeatedly. */
function applyTheme(next: Theme) {
  const root = document.documentElement;
  root.classList.add('cm');
  root.classList.toggle('cm-light', next === 'light');
  document.cookie = themeCookieString(next);
}

/**
 * Holds the active theme. Mounted once in app/layout.tsx with the theme the
 * server read from the `cm-theme` cookie, so the first client render matches
 * the SSR markup. `setTheme` updates <html>'s class and the cookie in place —
 * no reload, no router refresh.
 */
export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark') }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Current theme + setters. Outside a provider (e.g. global-error, which
 * replaces the root layout) it falls back to reading <html> and writing the
 * cookie directly, without re-rendering.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  const current: Theme =
    typeof document !== 'undefined' && document.documentElement.classList.contains('cm-light')
      ? 'light'
      : DEFAULT_THEME;
  return {
    theme: current,
    setTheme: applyTheme,
    toggleTheme: () => applyTheme(current === 'dark' ? 'light' : 'dark'),
  };
}
