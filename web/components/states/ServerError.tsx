'use client';

import type { ReactNode } from 'react';
import { Button, ButtonLink } from '@/components/ui/Button';
import { StatePage } from './StatePage';
import s from './states.module.css';

interface ServerErrorProps {
  title?: string;
  description?: ReactNode;
  /** Next's error digest — lets support find the server log line. */
  digest?: string;
  /** Re-render the segment (Next's `reset`). Hidden when absent. */
  onRetry?: () => void;
  homeHref?: string;
  fullPage?: boolean;
}

/**
 * 500. Used by app/error.tsx and app/global-error.tsx; also usable inline
 * for a failed panel. Never shows the raw error message — only the digest.
 */
export function ServerError({
  title = 'Something went wrong',
  description = 'An unexpected error stopped this page from loading. Trying again usually works; if it keeps happening, share the error ID below.',
  digest,
  onRetry,
  homeHref = '/',
  fullPage = false,
}: ServerErrorProps) {
  return (
    <StatePage fullPage={fullPage}>
      <div className={s.errorCard} role="alert">
        <div className={s.code} aria-hidden="true">
          500<span>.</span>
        </div>
        <h1 className={s.title}>{title}</h1>
        <p className={s.desc}>{description}</p>
        {digest && (
          <span className={s.digest}>
            Error ID: <span style={{ color: 'var(--fg-1)' }}>{digest}</span>
          </span>
        )}
        <div className={s.actions}>
          {onRetry && (
            <Button variant="primary" icon="refresh" onClick={onRetry}>
              Try again
            </Button>
          )}
          <ButtonLink href={homeHref} variant="default" icon="arrow-right">
            Go home
          </ButtonLink>
        </div>
      </div>
    </StatePage>
  );
}
