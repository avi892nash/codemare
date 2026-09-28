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

export const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const fontVariables = `${inter.variable} ${jetbrains.variable}`;
