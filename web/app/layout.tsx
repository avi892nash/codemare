import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Codemare',
  description: 'µs-precision online judge. Solve in microseconds.',
};

/**
 * The root layout wires fonts (loaded with next/font so they're inlined and
 * pre-loaded), and applies the `cm` class so the design tokens cascade to
 * every page. The actual chrome (navbar etc.) lives in app/(workspace)/layout.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="cm">{children}</body>
    </html>
  );
}
