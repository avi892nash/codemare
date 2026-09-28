import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { SessionProvider } from '@/components/Auth/SessionProvider';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { fontVariables } from '@/components/ui/fonts';
import { parseTheme, themeClassName, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Codemare',
  description:
    'Practice DSA and competitive programming with instant, sandboxed judging — and author your own lessons and problem sets.',
  icons: {
    icon: '/logo.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * Root layout. Loads fonts via next/font (inlined, preloaded) and puts the
 * theme classes on <html> from the `cm-theme` cookie — dark `cm` by default,
 * `cm cm-light` for light — so SSR paints the right theme with no flash.
 * Providers: session (useSession/signIn), theme (useTheme/ThemeToggle) and
 * toasts (useToast).
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([auth().catch(() => null), cookies()]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={`${fontVariables} ${themeClassName(theme)}`}>
      <body>
        <SessionProvider session={session}>
          <ThemeProvider initialTheme={theme}>
            <ToastProvider>{children}</ToastProvider>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
