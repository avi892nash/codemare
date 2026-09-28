/**
 * The client-side state of one run / submit / build stream (lib/sse.ts
 * RunEvent), as a pure reducer so it can be unit-tested without React.
 */
import type { RunEvent, TestEventData, VerdictEventData } from '@/lib/sse';

export type RunKind = 'run' | 'submit' | 'build';

/**
 * idle → connecting → queued → [compiling] → running → done
 *                                   ↘ failed (HTTP error, stream `error`, dropped connection)
 *                                   ↘ cancelled (by the learner)
 */
export type RunPhaseState = 'idle' | 'connecting' | 'queued' | 'compiling' | 'running' | 'done' | 'failed' | 'cancelled';

export const ACTIVE_PHASES: ReadonlySet<RunPhaseState> = new Set(['connecting', 'queued', 'compiling', 'running']);

export interface RunRequestError {
  /** HTTP status; null for network / stream failures. */
  status: number | null;
  /** The API's machine code (`access_denied`, `missing_dependencies`, `rate_limited`, …). */
  code: string | null;
  message: string;
  /** The full JSON error body (403 blockers, 409 `missing`, 429 `retryAfterSec`). */
  body: Record<string, unknown> | null;
}

export interface RunState {
  phase: RunPhaseState;
  kind: RunKind | null;
  submissionId: string | null;
  /** Known from `queued`. */
  totalTests: number | null;
  /** Judged tests, ordered by idx. */
  tests: TestEventData[];
  verdict: VerdictEventData | null;
  error: RunRequestError | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export const initialRunState: RunState = {
  phase: 'idle',
  kind: null,
  submissionId: null,
  totalTests: null,
  tests: [],
  verdict: null,
  error: null,
  startedAt: null,
  finishedAt: null,
};

export type RunAction =
  | { type: 'start'; kind: RunKind; at: number }
  | { type: 'event'; event: RunEvent; at: number }
  | { type: 'fail'; error: RunRequestError; at: number }
  | { type: 'cancel'; at: number }
  | { type: 'reset' };

const PHASE_RANK: Record<RunPhaseState, number> = {
  idle: 0,
  connecting: 1,
  queued: 2,
  compiling: 3,
  running: 4,
  done: 5,
  failed: 5,
  cancelled: 5,
};

/** Move forward only: a late `compiling` never drags `running` back. */
function advance(state: RunState, phase: RunPhaseState): RunPhaseState {
  return PHASE_RANK[phase] > PHASE_RANK[state.phase] ? phase : state.phase;
}

function insertTest(tests: TestEventData[], t: TestEventData): TestEventData[] {
  const rest = tests.filter((x) => x.idx !== t.idx);
  const at = rest.findIndex((x) => x.idx > t.idx);
  if (at === -1) return [...rest, t];
  return [...rest.slice(0, at), t, ...rest.slice(at)];
}

export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'reset':
      return initialRunState;
    case 'start':
      return { ...initialRunState, phase: 'connecting', kind: action.kind, startedAt: action.at };
    case 'cancel':
      if (!ACTIVE_PHASES.has(state.phase)) return state;
      return { ...state, phase: 'cancelled', finishedAt: action.at };
    case 'fail':
      if (state.phase === 'done' || state.phase === 'cancelled') return state;
      // Keep the first error (a stream `error` event beats "connection closed").
      if (state.phase === 'failed') return state;
      return { ...state, phase: 'failed', error: action.error, finishedAt: action.at };
    case 'event': {
      if (!ACTIVE_PHASES.has(state.phase)) return state;
      const e = action.event;
      switch (e.event) {
        case 'queued':
          return { ...state, phase: advance(state, 'queued'), submissionId: e.data.submissionId ?? null, totalTests: e.data.totalTests ?? null };
        case 'compiling':
          return { ...state, phase: advance(state, 'compiling') };
        case 'running':
          return { ...state, phase: advance(state, 'running') };
        case 'test':
          return { ...state, phase: advance(state, 'running'), tests: insertTest(state.tests, e.data) };
        case 'verdict':
          return {
            ...state,
            phase: 'done',
            verdict: e.data,
            submissionId: e.data.submissionId ?? state.submissionId,
            finishedAt: action.at,
          };
        case 'error':
          return {
            ...state,
            phase: 'failed',
            error: { status: null, code: 'judge_error', message: e.data.message || 'The judge failed.', body: null },
            finishedAt: action.at,
          };
      }
    }
  }
  return state;
}

/** An HTTP error response → RunRequestError (JSON body when there is one). */
export function requestError(status: number, body: unknown, fallback?: string): RunRequestError {
  const obj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const code = typeof obj?.error === 'string' ? obj.error : null;
  const message =
    typeof obj?.message === 'string' && obj.message
      ? obj.message
      : fallback ??
        (status === 401
          ? 'Your session has expired — sign in again.'
          : status === 429
            ? 'Too many runs in a row — wait a moment.'
            : status >= 500
              ? 'The server had a problem. Try again in a moment.'
              : `Request failed (${status}).`);
  return { status, code, message, body: obj };
}
