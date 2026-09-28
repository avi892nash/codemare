import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSse, type RunStreamEvent } from './compile';
import type { IdeExecutionResponse } from './types';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<RunStreamEvent[]> {
  const out: RunStreamEvent[] = [];
  for await (const e of parseSse(streamOf(chunks))) out.push(e);
  return out;
}

describe('parseSse', () => {
  it('parses a full run stream in order', async () => {
    const events = await collect([
      'event: queued\ndata: {}\n\n',
      'event: running\ndata: {}\n\n',
      'event: test\ndata: {"idx":0,"passed":true,"runUs":12}\n\n',
      'event: verdict\ndata: {"status":"OK","totalPassed":1,"totalTests":1}\n\n',
    ]);
    expect(events.map((e) => e.event)).toEqual(['queued', 'running', 'test', 'verdict']);
    expect(events[3].data).toMatchObject({ status: 'OK' });
  });

  it('reassembles frames split across arbitrary chunk boundaries', async () => {
    const frame = 'event: test\ndata: {"idx":3,"passed":false}\n\n';
    const events = await collect(frame.split(''));
    expect(events).toEqual([{ event: 'test', data: { idx: 3, passed: false } }]);
  });

  it('handles CRLF line endings and heartbeat comments', async () => {
    const events = await collect([': ping\r\n\r\n', 'event: verdict\r\ndata: {"status":"WA"}\r\n\r\n']);
    expect(events).toEqual([{ event: 'verdict', data: { status: 'WA' } }]);
  });

  it('joins multi-line data and skips malformed frames', async () => {
    const events = await collect([
      'event: error\ndata: {"message":\ndata: "boom"}\n\n',
      'event: test\ndata: {not json}\n\n',
      'event: verdict\ndata: {"status":"CE"}\n\n',
    ]);
    expect(events).toEqual([
      { event: 'error', data: { message: 'boom' } },
      { event: 'verdict', data: { status: 'CE' } },
    ]);
  });
});

describe('compile.executeIde', () => {
  const saved = { url: process.env.COMPILE_SERVICE_URL, token: process.env.INTERNAL_TOKEN };
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [key, value] of [['COMPILE_SERVICE_URL', saved.url], ['INTERNAL_TOKEN', saved.token]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** A fresh module, so BASE and TOKEN are read from the env set here. */
  async function loadCompile(url: string | undefined) {
    vi.resetModules();
    if (url === undefined) delete process.env.COMPILE_SERVICE_URL;
    else process.env.COMPILE_SERVICE_URL = url;
    process.env.INTERNAL_TOKEN = 'test-token';
    return (await import('./compile')).compile;
  }

  function stubFetch(replies: Response[]) {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => replies.shift()!);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const request = { language: 'python' as const, code: 'print(1)', testCases: [{ input: '', expectedOutput: '1' }] };
  const result: IdeExecutionResponse = {
    success: true,
    testResults: [],
    totalPassed: 1,
    totalTests: 1,
    totalExecutionTime: 3,
  };

  it('returns an inline result (queue off, or ?wait=true) from the default service URL', async () => {
    const fetchMock = stubFetch([Response.json(result)]);
    const compile = await loadCompile(undefined);
    await expect(compile.executeIde(request)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/v1/ide/execute');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('X-Codemare-Token')).toBe('test-token');
  });

  it('polls GET /v1/ide/execute/:token after a 202 until the result is ready', async () => {
    const fetchMock = stubFetch([
      Response.json({ token: 'tok-1', status: 'PND' }, { status: 202 }),
      Response.json({ status: 'PND' }),
      Response.json(result),
    ]);
    const compile = await loadCompile('http://compile.test/');
    await expect(compile.executeIde(request)).resolves.toEqual(result);
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)).toEqual([
      'POST http://compile.test/v1/ide/execute',
      'GET http://compile.test/v1/ide/execute/tok-1',
      'GET http://compile.test/v1/ide/execute/tok-1',
    ]);
  });
});
