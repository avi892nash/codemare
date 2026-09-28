import { Inter, JetBrains_Mono } from 'next/font/google';

/**
 * The two typefaces, self-hosted via next/font and exposed as --font-sans /
 * --font-mono (globals.css reads them). Shared by app/layout.tsx and
 * app/global-error.tsx, which replaces the root layout when it fails.
 */
export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

// Not preloaded: a 40 KB preload competes with the render-blocking CSS on a
// slow link and pushed the editor's first paint back ~0.5 s (4G, applied
// throttling). Mono text paints in its metric-matched fallback until the
// font lands — and `--font-mono` is mostly numbers, code and IDs.
export const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  preload: false,
});

export const fontVariables = `${inter.variable} ${jetbrains.variable}`;
