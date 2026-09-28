'use client';

import { useEffect } from 'react';
import { ServerError } from '@/components/states/ServerError';
import { fontVariables } from '@/components/ui/fonts';
import { parseTheme, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

/**
 * Last-resort boundary: replaces the root layout when it throws, so it must
 * render <html>/<body> itself and load globals.css + fonts on its own. It
 * cannot read cookies on the server, so it applies the saved theme on mount.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    const saved = document.cookie
      .split('; ')
      .find((c) => c.startsWith(`${THEME_COOKIE}=`))
      ?.split('=')[1];
    document.documentElement.classList.toggle('cm-light', parseTheme(saved) === 'light');
  }, [error]);

  return (
    <html lang="en" className={`${fontVariables} cm`}>
      <body>
        <ServerError fullPage digest={error.digest} onRetry={reset} />
      </body>
    </html>
  );
}
