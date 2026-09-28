'use client';

import { useEffect } from 'react';
import { markStepSeenAction } from '@/app/(workspace)/queue/actions';

/** The step visit being recorded right now, if any. */
let visitInFlight: Promise<unknown> | null = null;

/** Record that the learner opened a step (step_progress `seen`, never a downgrade). */
export function useStepVisit(stepId: string, done: boolean): void {
  useEffect(() => {
    if (done) return;
    const p: Promise<unknown> = markStepSeenAction(stepId).catch(() => undefined);
    visitInFlight = p;
    void p.finally(() => {
      if (visitInFlight === p) visitInFlight = null;
    });
  }, [stepId, done]);
}

/**
 * Wait until no router action of ours is in flight. Next's router queues
 * actions; a history restore (see pinStep) takes priority over a pending
 * one and *discards* it — a discarded server action leaves the router
 * stuck, and later refreshes never show. A server action's promise
 * resolves a moment before the router drops it from the queue, hence the
 * extra macrotask. The timeout covers a visit already discarded by a
 * navigation (its promise never settles).
 */
export async function settleRouterActions(): Promise<void> {
  if (visitInFlight) await Promise.race([visitInFlight, new Promise((r) => setTimeout(r, 2000))]);
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * Put `stepId` in the URL (`/queue` → `/queue?step=…`) without a
 * navigation, so the next server render keeps this step on screen: plain
 * `/queue` focuses whatever is current, which after a prediction or a
 * passing build is the *next* step. Next's router adopts a
 * `history.replaceState(null, …)` as its own URL. Call it from an event
 * (the router wires that up after hydration), with no router action in
 * flight — settleRouterActions() first.
 */
export function pinStep(stepId: string): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get('step') === stepId) return;
  url.searchParams.set('step', stepId);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

/** Re-render from the server around `stepId`: the list advances and the navbar's token total updates. */
export async function refreshKeepingStep(router: { refresh(): void }, stepId: string): Promise<void> {
  await settleRouterActions();
  pinStep(stepId);
  router.refresh();
}
