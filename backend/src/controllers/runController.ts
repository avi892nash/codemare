import { Request, Response } from 'express';
import { executeRun } from '../services/runService.js';
import { validateRunRequest } from '../services/runValidation.js';

/**
 * POST /v1/run — run caller-supplied code against caller-supplied tests and
 * answer with the full result (RunResponse). Always synchronous and inline:
 * the pure-executor contract doesn't go through the Redis queue.
 */
export async function runJson(req: Request, res: Response): Promise<void> {
  const validation = validateRunRequest(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error, details: validation.details });
    return;
  }
  const result = await executeRun(validation.value);
  res.json(result);
}

/** Interval of SSE comment lines that keep proxies from closing an idle stream
 *  (overridable for tests). */
const HEARTBEAT_MS = Number(process.env.RUN_STREAM_HEARTBEAT_MS) || 15_000;

/**
 * POST /v1/run/stream — the same run as Server-Sent Events:
 *
 *   event: queued     data: {}          only when waiting for a sandbox box
 *   event: compiling  data: {}          compiled languages (and TypeScript)
 *   event: running    data: {}
 *   event: test       data: RunTestResult   one per test, in index order
 *   event: verdict    data: RunVerdict      last event (no `tests` array)
 *   event: error      data: {message}       only if the run itself blew up
 *
 * A CE / XX verdict comes without any `test` events. Validation errors are a
 * plain 400 JSON response — the stream only opens for a valid request.
 * Heartbeat comments (": keep-alive") go out every 15 s. If the client
 * disconnects the run is aborted (see RunOptions.signal).
 */
export async function runStream(req: Request, res: Response): Promise<void> {
  const validation = validateRunRequest(req.body);
  if (!validation.ok) {
    res.status(400).json({ error: validation.error, details: validation.details });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Tell nginx-style proxies not to buffer the stream.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const abort = new AbortController();
  // 'close' after end() is the normal finish; before it, the client left.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  const open = (): boolean => !res.writableEnded && !res.destroyed;
  const send = (event: string, data: unknown): void => {
    if (open()) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const heartbeat = setInterval(() => {
    if (open()) res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);

  try {
    const result = await executeRun(validation.value, {
      onPhase: (phase) => send(phase, {}),
      onTest: (test) => send('test', test),
      signal: abort.signal,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { tests, ...verdict } = result;
    send('verdict', verdict);
  } catch (err) {
    send('error', { message: err instanceof Error ? err.message : 'Run failed' });
  } finally {
    clearInterval(heartbeat);
    if (open()) res.end();
  }
}
