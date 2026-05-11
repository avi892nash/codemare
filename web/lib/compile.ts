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

  /** Run a Problems-mode submission against the testcases. */
  execute(request: ExecutionRequest): Promise<ExecutionResponse> {
    return call<ExecutionResponse>('/v1/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /** Run an IDE-mode submission (raw stdin/stdout, multiple custom testcases). */
  executeIde(request: IdeExecutionRequest): Promise<IdeExecutionResponse> {
    return call<IdeExecutionResponse>('/v1/ide/execute', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /** Liveness probe — useful for an /api/health proxy or a status page. */
  health(): Promise<{ status: string; timestamp: string }> {
    return call('/health');
  },
};
