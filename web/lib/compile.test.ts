import { describe, expect, it } from 'vitest';
import { parseSse, type RunStreamEvent } from './compile';

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
