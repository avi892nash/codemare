'use client';

import { useEffect } from 'react';
import { ServerError } from '@/components/states/ServerError';

/**
 * Error boundary for everything under the root layout. Renders the shared 500
 * state; `reset` re-renders the failed segment. The message stays in the
 * console/server log — users only see the digest.
 */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ServerError fullPage digest={error.digest} onRetry={reset} />;
}
