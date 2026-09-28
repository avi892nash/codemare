'use client';

import { useEffect } from 'react';
import { markStepSeenAction } from '@/app/(workspace)/queue/actions';

/**
 * While a step is open: put it in the URL (`/queue` → `/queue?step=…`,
 * without a navigation) so refreshing the queue after a prediction or a
 * passing build keeps this step on screen while the list advances — and
 * record the visit (step_progress `seen`, never a downgrade).
 */
export function usePinnedStep(stepId: string, done: boolean): void {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('step') !== stepId) {
      url.searchParams.set('step', stepId);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, [stepId]);

  useEffect(() => {
    if (!done) void markStepSeenAction(stepId).catch(() => undefined);
  }, [stepId, done]);
}
