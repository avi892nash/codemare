'use client';

import { useEffect } from 'react';
import { ServerError } from '@/components/states/ServerError';

/** Error boundary for /submissions and /submissions/[id]. */
export default function SubmissionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ServerError
      title="Submissions didn’t load"
      description="Something went wrong on our side. Trying again usually works; if it keeps happening, share the error ID below."
      digest={error.digest}
      onRetry={reset}
      homeHref="/map"
    />
  );
}
