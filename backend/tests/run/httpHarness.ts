// Shared helpers for the HTTP-level run tests: boot the real Express app on
// an ephemeral port with the local sandbox adapter, and read SSE streams.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export interface SseEvent {
  event: string;
  data: unknown;
}

export interface TestServer {
  url: string;
  close(): Promise<void>;
}

/** Must run before the app (and so sandboxService) is first imported. */
export async function startTestServer(env: Record<string, string> = {}): Promise<TestServer> {
  process.env.SANDBOX_MODE = 'local';
  delete process.env.INTERNAL_TOKEN;
  delete process.env.REDIS_URL;
  Object.assign(process.env, env);
  const { default: app } = await import('../../src/app.js');
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export async function postJson(
  url: string,
  body: unknown
): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** Parse a complete SSE body into events; comment lines are returned as event ':'. */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.split('\n\n')) {
    if (block.trim() === '') continue;
    if (block.startsWith(':')) {
      events.push({ event: ':', data: block.slice(1).trim() });
      continue;
    }
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    events.push({ event, data: data === '' ? undefined : JSON.parse(data) });
  }
  return events;
}

export async function postSse(
  url: string,
  body: unknown
): Promise<{ status: number; contentType: string | null; events: SseEvent[]; raw: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  const contentType = res.headers.get('content-type');
  return {
    status: res.status,
    contentType,
    events: contentType?.startsWith('text/event-stream') ? parseSse(raw) : [],
    raw,
  };
}
