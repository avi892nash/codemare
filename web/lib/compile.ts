import 'server-only';
import type {
  ExecutionRequest,
  ExecutionResponse,
  IdeExecutionRequest,
  IdeExecutionResponse,
  Problem,
  ProblemListItem,
  Signature,
  SupportedLanguage,
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

// Startup guard: in production a missing or placeholder INTERNAL_TOKEN means
// every compile-service call would go out unauthenticated (or with a
// well-known value). Fail loudly at module load instead of at request time.
// Never log the token itself.
if (process.env.NODE_ENV === 'production' && (!TOKEN || TOKEN.startsWith('replace-me'))) {
  throw new Error(
    'INTERNAL_TOKEN is missing or still the placeholder. Generate one with ' +
      '`openssl rand -hex 32` and set it in the environment before starting the web app.'
  );
}

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

// ─── Pure-executor contract: backend POST /v1/run and /v1/run/stream ────────
// (docs/spec/architecture.md §5). The caller supplies everything the harness
// needs; the compile service keeps no state about questions.

export interface RunTestSpec {
  input: unknown[];
  expected: unknown;
  hidden?: boolean;
}

export interface RunRequest {
  language: SupportedLanguage;
  code: string;
  /** Dependency sources placed before `code` (same language; never Java). */
  prelude?: string[];
  functionName: string;
  /** Required for cpp, java and go. */
  signature?: Signature;
  compareMode?: 'ordered' | 'unordered';
  tests: RunTestSpec[];
  limits?: { timeMs?: number; memoryMb?: number };
}

export type RunStatus = 'OK' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX';

export interface RunTestResult {
  idx: number;
  hidden: boolean;
  passed: boolean;
  /** CPU time of the call in µs. */
  runUs: number;
  /** Wall time of the call in µs — diagnostic only. */
  wallUs: number;
  memoryKb: number;
  actual: unknown;
  error?: string;
}

export interface RunVerdict {
  status: RunStatus;
  totalPassed: number;
  totalTests: number;
  /** Sum of per-test runUs. */
  runUs: number;
  /** Max per-test memoryKb. */
  memoryKb: number;
  compileMs?: number;
  error?: string;
}

export interface RunResponse extends RunVerdict {
  tests: RunTestResult[];
}

export type RunStreamEvent =
  | { event: 'queued'; data: Record<string, unknown> }
  | { event: 'compiling'; data: Record<string, unknown> }
  | { event: 'running'; data: Record<string, unknown> }
  | { event: 'test'; data: RunTestResult }
  | { event: 'verdict'; data: RunVerdict }
  | { event: 'error'; data: { message: string } };

/**
 * Parse a text/event-stream body into events. Handles multi-line `data:`,
 * CRLF, and `:` heartbeat comments; ignores events with unparseable JSON.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<RunStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length === 0) continue;
        try {
          yield { event, data: JSON.parse(data.join('\n')) } as RunStreamEvent;
        } catch {
          // Malformed frame — skip it rather than abort the whole stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const compile = {
  /** Judge code against caller-supplied tests; resolves with the full result. */
  run(request: RunRequest): Promise<RunResponse> {
    return call<RunResponse>('/v1/run', { method: 'POST', body: JSON.stringify(request) });
  },

  /**
   * Same as run(), streamed: queued → compiling → running → test… → verdict.
   * Pass an AbortSignal to cancel (the service aborts the sandbox run when the
   * connection drops).
   */
  async *runStream(request: RunRequest, signal?: AbortSignal): AsyncGenerator<RunStreamEvent> {
    const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
    if (TOKEN) headers.set('X-Codemare-Token', TOKEN);
    const res = await fetch(`${BASE}/v1/run/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      cache: 'no-store',
      signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new CompileServiceError(res.status, body || res.statusText);
    }
    yield* parseSse(res.body);
  },

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
