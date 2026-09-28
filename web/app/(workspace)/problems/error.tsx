'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ServerError } from '@/components/states/ServerError';

/**
 * Error boundary for /problems (and /problems/[slug] until it has its own):
 * the shared 500 state inside the workspace, with a retry.
 */
export default function ProblemsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    console.error(error);
  }, [error]);
  const catalog = pathname === '/problems';
  return (
    <ServerError
      title={catalog ? 'The problem list didn’t load' : 'This problem didn’t load'}
      description="Something went wrong on our side. Trying again usually works; if it keeps happening, share the error ID below."
      digest={error.digest}
      onRetry={reset}
      homeHref="/problems"
    />
  );
}
