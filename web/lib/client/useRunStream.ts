'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { isRunEvent, readSseEvents, type VerdictEventData } from '@/lib/sse';
import {
  ACTIVE_PHASES,
  initialRunState,
  requestError,
  runReducer,
  type RunKind,
  type RunState,
} from './runState';

export type { RunKind, RunState, RunPhaseState, RunRequestError } from './runState';

/** Where each kind posts. */
export const RUN_ENDPOINTS: Record<RunKind, string> = {
  run: '/api/run',
  submit: '/api/submit',
  build: '/api/build',
};

export interface RunStream extends RunState {
  /** Any request in flight. */
  busy: boolean;
  /**
   * POST `body` to the kind's endpoint and follow the stream. Resolves with
   * the verdict — or null (HTTP error, dropped stream, cancelled; see `error`).
   * Starting again cancels the previous stream.
   */
  start: (kind: RunKind, body: unknown) => Promise<VerdictEventData | null>;
  /** Stop following (the server then aborts the judge). */
  cancel: () => void;
  /** Back to idle. */
  reset: () => void;
}

/**
 * POST + follow a run / submit / build stream (lib/sse.ts protocol):
 * `{phase, tests, verdict, error, start, cancel}`. Test events land in
 * `tests` (ordered by idx) as they arrive; errors before the stream opens
 * (401/403/404/409/413/429) come back in `error` with their JSON body.
 */
export function useRunStream(): RunStream {
  const [state, dispatch] = useReducer(runReducer, initialRunState);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(async (kind: RunKind, body: unknown): Promise<VerdictEventData | null> => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    dispatch({ type: 'start', kind, at: Date.now() });

    let res: Response;
    try {
      res = await fetch(RUN_ENDPOINTS[kind], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: ac.signal,
        cache: 'no-store',
      });
    } catch {
      if (!ac.signal.aborted) {
        dispatch({
          type: 'fail',
          at: Date.now(),
          error: { status: null, code: 'network', message: 'Couldn’t reach the server. Check your connection and try again.', body: null },
        });
      }
      return null;
    }

    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('text/event-stream') || !res.body) {
      const json = type.includes('application/json') ? await res.json().catch(() => null) : null;
      // A 200 that isn't a stream is the sign-in page the auth wall redirected to.
      const status = res.ok ? 401 : res.status;
      dispatch({ type: 'fail', at: Date.now(), error: requestError(status, json) });
      return null;
    }

    let verdict: VerdictEventData | null = null;
    try {
      for await (const e of readSseEvents(res.body)) {
        if (!isRunEvent(e)) continue;
        dispatch({ type: 'event', event: e, at: Date.now() });
        if (e.event === 'verdict') verdict = e.data;
      }
    } catch {
      // aborted or dropped — handled below
    }
    if (!verdict && !ac.signal.aborted) {
      dispatch({
        type: 'fail',
        at: Date.now(),
        error: { status: null, code: 'stream_closed', message: 'The connection closed before the verdict. Try again.', body: null },
      });
    }
    if (controller.current === ac) controller.current = null;
    return verdict;
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: 'cancel', at: Date.now() });
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    dispatch({ type: 'reset' });
  }, []);

  return { ...state, busy: ACTIVE_PHASES.has(state.phase), start, cancel, reset };
}
