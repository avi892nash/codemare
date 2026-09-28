import { describe, expect, it } from 'vitest';
import { encodeSseComment, encodeSseEvent, isRunEvent, readSseEvents, readSseFrames, type SseFrame } from './sse';

function streamOf(chunks: Array<string | Uint8Array>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(typeof c === 'string' ? enc.encode(c) : c);
      controller.close();
    },
  });
}

async function frames(chunks: Array<string | Uint8Array>): Promise<SseFrame[]> {
  const out: SseFrame[] = [];
  for await (const f of readSseFrames(streamOf(chunks))) out.push(f);
  return out;
}

describe('readSseFrames', () => {
  it('splits frames and defaults the event name to "message"', async () => {
    expect(await frames(['data: a\n\nevent: x\ndata: b\n\n'])).toEqual([
      { event: 'message', data: 'a' },
      { event: 'x', data: 'b' },
    ]);
  });

  it('handles LF, CRLF and lone CR line ends — including a CRLF split across chunks', async () => {
    expect(await frames(['event: a\r', '\ndata: 1\r', '\n\r', '\nevent: b\rdata: 2\r\r'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('reassembles frames split at every byte, including inside a multi-byte character', async () => {
    const bytes = new TextEncoder().encode('event: test\ndata: {"s":"µs → ✓"}\n\n');
    const chunks = Array.from(bytes, (b) => new Uint8Array([b]));
    expect(await frames(chunks)).toEqual([{ event: 'test', data: '{"s":"µs → ✓"}' }]);
  });

  it('ignores comments, joins multi-line data, strips one leading space only', async () => {
    expect(await frames([': keep-alive\n\n', 'data:  two spaces\ndata:x\n\n'])).toEqual([
      { event: 'message', data: ' two spaces\nx' },
    ]);
  });

  it('drops frames without data and a trailing frame without its blank line', async () => {
    expect(await frames(['event: empty\n\n', 'data: kept\n\n', 'data: cut off'])).toEqual([
      { event: 'message', data: 'kept' },
    ]);
  });

  it('keeps the last id', async () => {
    expect(await frames(['id: 7\ndata: a\n\n'])).toEqual([{ event: 'message', data: 'a', id: '7' }]);
  });
});

describe('readSseEvents', () => {
  it('parses JSON data and skips malformed frames', async () => {
    const out = [];
    for await (const e of readSseEvents(streamOf(['event: a\ndata: {"n":1}\n\n', 'event: b\ndata: {nope}\n\n', 'event: c\ndata: [1]\n\n']))) {
      out.push(e);
    }
    expect(out).toEqual([
      { event: 'a', data: { n: 1 } },
      { event: 'c', data: [1] },
    ]);
  });
});

describe('encoding', () => {
  it('round-trips events and comments', async () => {
    const text = encodeSseComment('hello\nworld') + encodeSseEvent('verdict', { status: 'OK', note: 'a\nb' });
    expect(text.startsWith(': hello\n: world\n\n')).toBe(true);
    const out = [];
    for await (const e of readSseEvents(streamOf([text]))) out.push(e);
    expect(out).toEqual([{ event: 'verdict', data: { status: 'OK', note: 'a\nb' } }]);
  });

  it('rejects event names with line breaks', () => {
    expect(() => encodeSseEvent('a\nb', {})).toThrow();
  });

  it('recognizes run events', () => {
    expect(isRunEvent({ event: 'test', data: { idx: 0 } })).toBe(true);
    expect(isRunEvent({ event: 'bogus', data: {} })).toBe(false);
    expect(isRunEvent({ event: 'verdict', data: 'x' })).toBe(false);
  });
});
