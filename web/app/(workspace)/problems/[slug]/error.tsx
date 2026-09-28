'use client';

import { useEffect } from 'react';
import { ServerError } from '@/components/states/ServerError';

/**
 * The editor's own error boundary: a failed load keeps the navbar and offers
 * a retry of just this segment. The message stays in the console — users
 * only see the digest.
 */
export default function ProblemError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ServerError
      title="This problem didn’t load"
      description="Something went wrong while loading the problem. Your drafts are saved in this browser — try again."
      digest={error.digest}
      onRetry={reset}
      homeHref="/problems"
    />
  );
}
