/**
 * Server-Sent Events, both directions, plus the web app's run protocol
 * (docs/spec/architecture.md §4). Isomorphic: no Node- or DOM-only APIs, so
 * the route handlers (encoding), the compile-service client (decoding its
 * stream) and the browser hook (decoding ours) share one implementation.
 */
import type { Verdict } from '@/lib/types';

// ─── Frames ──────────────────────────────────────────────────────────────

export interface SseFrame {
  /** `event:` field; "message" when absent. */
  event: string;
  /** `data:` lines joined with "\n". */
  data: string;
  id?: string;
}

/**
 * Split a text/event-stream body into frames, per the WHATWG parsing rules
 * that matter here: LF, CRLF or lone-CR line ends (even when a CRLF is split
 * across chunks), `:` comments (heartbeats) ignored, one optional space
 * after the colon stripped, multi-line `data:` joined, frames without data
 * dropped, and a trailing frame without its blank line discarded.
 */
export async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;

  const takeLine = (line: string): SseFrame | null => {
    if (line === '') {
      const frame = data.length > 0 ? { event: event || 'message', data: data.join('\n'), ...(id ? { id } : {}) } : null;
      event = '';
      data = [];
      return frame;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
    return null;
  };

  /** Complete lines out of `buffer`; at the end of the stream a trailing CR ends its line too. */
  function* drain(final: boolean): Generator<SseFrame> {
    let start = 0;
    for (let i = 0; i < buffer.length; i++) {
      const ch = buffer[i];
      if (ch !== '\n' && ch !== '\r') continue;
      // A CR at the very end may be the first half of a split CRLF: wait for more.
      if (ch === '\r' && i === buffer.length - 1 && !final) break;
      const frame = takeLine(buffer.slice(start, i));
      if (ch === '\r' && buffer[i + 1] === '\n') i++;
      start = i + 1;
      if (frame) yield frame;
    }
    buffer = buffer.slice(start);
  }

  let finished = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* drain(false);
    }
    finished = true;
    buffer += decoder.decode();
    yield* drain(true);
  } finally {
    // A consumer that stops early (break / return / throw) closes the
    // connection instead of leaving the body to drain.
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Frames with their `data` JSON-parsed; frames whose data is not JSON are skipped. */
export async function* readSseEvents<E extends { event: string; data: unknown } = { event: string; data: unknown }>(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<E> {
  for await (const frame of readSseFrames(body)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      continue; // malformed frame — skip it rather than abort the stream
    }
    yield { event: frame.event, data: parsed } as E;
  }
}

/** One event frame. `data` is JSON-encoded on a single line. */
export function encodeSseEvent(event: string, data: unknown): string {
  if (/[\r\n]/.test(event)) throw new Error('SSE event names cannot contain line breaks');
  return `event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
}

/** A comment frame — used as a heartbeat that keeps proxies from closing an idle stream. */
export function encodeSseComment(text = ''): string {
  return `${text
    .split(/\r\n|\r|\n/)
    .map((line) => `: ${line}`)
    .join('\n')}\n\n`;
}

export const SSE_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  // no-transform also keeps Next's gzip (and any proxy) from buffering the stream.
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

// ─── The web run protocol (POST /api/run · /api/submit · /api/build) ────

/** Judge phases in the order they can happen. `compiling` only for a real compile. */
export const RUN_PHASES = ['queued', 'compiling', 'running'] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

/**
 * `queued` — always the first event: the submission row exists and waits for
 * the judge. `totalTests` lets the UI draw one tick per test up front.
 */
export interface QueuedEventData {
  submissionId: string;
  totalTests: number;
}

/** One judged test (hidden tests never carry input / expected / actual). */
export interface TestEventData {
  /** Position in this run's test list. */
  idx: number;
  passed: boolean;
  hidden: boolean;
  /** CPU µs of the call; null when the test did not complete. */
  runtimeUs: number | null;
  /** KB; null when not measured (Java, and C++ per test). */
  memoryKb: number | null;
  input?: unknown;
  expected?: unknown;
  actual?: unknown;
  error?: string;
  /** The author's note for this test — only on failures. */
  explainOnFail?: string;
  /** A learner-added input (`/api/run`); expected came from the reference solution. */
  custom?: boolean;
}

export interface TokenAwardEvent {
  /** Topic slug. */
  topic: string;
  title: string;
  amount: number;
}

export interface BadgeAwardEvent {
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  rarity?: string;
}

export interface VerdictEventData {
  status: Verdict;
  totalPassed: number;
  totalTests: number;
  /** Σ per-test CPU µs; null when nothing ran (CE / XX). */
  runtimeUs: number | null;
  /** Peak KB; null when not measured. */
  memoryKb: number | null;
  compileMs?: number;
  submissionId?: string;
  /** "Beats N%" — accepted `submit` only. */
  percentile?: number | null;
  /** First accepted submit / first passing build only. */
  tokensAwarded?: TokenAwardEvent[];
  badgesAwarded?: BadgeAwardEvent[];
  /** `build` only: the component version this run recorded. */
  componentVersionId?: string | null;
  error?: string;
}

export interface ErrorEventData {
  message: string;
}

export type RunEvent =
  | { event: 'queued'; data: QueuedEventData }
  | { event: 'compiling'; data: Record<string, never> }
  | { event: 'running'; data: Record<string, never> }
  | { event: 'test'; data: TestEventData }
  | { event: 'verdict'; data: VerdictEventData }
  | { event: 'error'; data: ErrorEventData };

export type RunEventName = RunEvent['event'];

const RUN_EVENT_NAMES: ReadonlySet<string> = new Set(['queued', 'compiling', 'running', 'test', 'verdict', 'error']);

export function isRunEvent(e: { event: string; data: unknown }): e is RunEvent {
  return RUN_EVENT_NAMES.has(e.event) && typeof e.data === 'object' && e.data !== null;
}

export function encodeRunEvent(e: RunEvent): string {
  return encodeSseEvent(e.event, e.data);
}
