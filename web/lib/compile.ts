import 'server-only';
import type {
  ExecutionRequest,
  ExecutionResponse,
  IdeExecutionRequest,
  IdeExecutionResponse,
  Problem,
  ProblemListItem,
} from './types';

/**
 * Server-only HTTP client for the compile service.
 *
 * Everything in this module:
 *   1. runs only on the Next.js server (the 'server-only' import will fail at
 *      build time if any client component pulls this in by accident),
 *   2. reads INTERNAL_TOKEN from env and attaches it as X-Codemare-Token,
 *   3. never includes credentials in client-rendered HTML.
 *
 * Callers in the workspace pages should `await compile.listProblems()` etc.
 * directly from server components, or invoke them from server actions /
 * route handlers when the call is triggered by a client component.
 */

const BASE = (process.env.COMPILE_SERVICE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const TOKEN = process.env.INTERNAL_TOKEN ?? '';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (TOKEN) headers.set('X-Codemare-Token', TOKEN);

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CompileServiceError(res.status, body || res.statusText);
  }
  return res.json() as Promise<T>;
}

export class CompileServiceError extends Error {
  constructor(public status: number, body: string) {
    super(`compile service ${status}: ${body.slice(0, 200)}`);
    this.name = 'CompileServiceError';
  }
}

/** A 202 token response from the async submit path. */
interface TokenResponse {
  token: string;
  status: 'PND';
}

function isToken(v: unknown): v is TokenResponse {
  return typeof v === 'object' && v !== null && 'token' in v;
}

/** Pending poll responses are exactly `{ status: 'PND' }`; the final result
 *  never carries that marker (Problems results use OK/WA/…; IDE has none). */
function isPending(v: unknown): boolean {
  return typeof v === 'object' && v !== null && (v as { status?: string }).status === 'PND';
}

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a submission to its final result. The compile service replies either
 * with the full result (synchronous mode — queue disabled, or ?wait=true) or
 * with a { token } (async mode — queue enabled). For a token we poll the
 * matching GET endpoint until it is no longer pending. The web app needs no
 * config: it transparently uses whichever mode the service is running.
 */
async function resolveSubmission<T>(
  submitPath: string,
  pollPathFor: (token: string) => string,
  body: string
): Promise<T> {
  const first = await call<T | TokenResponse>(submitPath, { method: 'POST', body });
  if (!isToken(first)) return first as T;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const pollPath = pollPathFor(first.token);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(POLL_INTERVAL_MS);
    const polled = await call<T>(pollPath);
    if (!isPending(polled)) return polled;
    if (Date.now() > deadline) {
      throw new CompileServiceError(504, `submission ${first.token} timed out`);
    }
  }
}

export const compile = {
  /** List all problems in the catalog. Cheap, cacheable per-request. */
  listProblems(): Promise<ProblemListItem[]> {
    return call<{ problems: ProblemListItem[] }>('/v1/problems').then((r) => r.problems);
  },

  /** Full problem (with hidden testcases hidden behind sanitize). */
  getProblem(id: string): Promise<Problem> {
    return call<{ problem: Problem }>(`/v1/problems/${encodeURIComponent(id)}`).then(
      (r) => r.problem
    );
  },

  /** Run a Problems-mode submission. Works in both sync and async service modes. */
  execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    return resolveSubmission<ExecutionResponse>(
      '/v1/execute',
      (token) => `/v1/execute/${token}`,
      JSON.stringify(request)
    );
  },

  /** Run an IDE-mode submission (raw stdin/stdout, multiple custom testcases). */
  executeIde(request: IdeExecutionRequest): Promise<IdeExecutionResponse> {
    return resolveSubmission<IdeExecutionResponse>(
      '/v1/ide/execute',
      (token) => `/v1/ide/execute/${token}`,
      JSON.stringify(request)
    );
  },

  /** Liveness probe — useful for an /api/health proxy or a status page. */
  health(): Promise<{ status: string; timestamp: string }> {
    return call('/health');
  },
};
