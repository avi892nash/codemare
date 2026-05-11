import type { Config } from 'tailwindcss';

/**
 * Tailwind here is light-touch — the design language is built on CSS custom
 * properties (see app/globals.css) so colors / spacing come from `var(--bg-0)`
 * etc. We keep Tailwind for utility classes (flex, grid, p-*, hidden, etc.)
 * but never define a parallel color palette.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx,js,jsx,mdx}',
    './components/**/*.{ts,tsx,js,jsx,mdx}',
    './lib/**/*.{ts,tsx,js,jsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
};

export default config;
