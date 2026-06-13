import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { auth } from '@/auth';
import { SessionProvider } from '@/components/Auth/SessionProvider';
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
  description:
    'Practice DSA and competitive programming with instant, sandboxed judging — and author your own lessons and problem sets.',
};

/**
 * Root layout. Loads fonts via next/font (inlined, preloaded), applies the
 * `cm` class so the design tokens cascade, and wraps the tree in
 * SessionProvider so client components can `useSession()` / `signIn()`.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth().catch(() => null);
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="cm">
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  );
}
