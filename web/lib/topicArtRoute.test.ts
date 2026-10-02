import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/topic-art/[slug]/route';
import { sceneSvg } from '@/components/TopicArt/TopicArt';

/** The lazily loaded scenes' route: the svg of one scene per URL, compressed by the handler itself, cached for good. */

const call = (slug: string, acceptEncoding?: string) =>
  GET(new Request(`http://localhost/api/topic-art/${slug}`, { headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {} }), {
    params: Promise.resolve({ slug }),
  });
const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

describe('GET /api/topic-art/[slug]', () => {
  it('sends the scene’s whole svg, brotli-compressed when the browser takes it', async () => {
    const res = await call('stack', 'gzip, deflate, br');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('br');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('vary')).toBe('Accept-Encoding');
    const body = await bytes(res);
    expect(brotliDecompressSync(body).toString()).toBe(sceneSvg('stack'));
    expect(body.length).toBeLessThan(sceneSvg('stack').length / 3);
  });

  it('falls back to gzip, then to the plain text', async () => {
    const gz = await call('graphs', 'gzip');
    expect(gz.headers.get('content-encoding')).toBe('gzip');
    expect(gunzipSync(await bytes(gz)).toString()).toBe(sceneSvg('graphs'));
    const plain = await call('graphs');
    expect(plain.headers.get('content-encoding')).toBeNull();
    expect(await plain.text()).toBe(sceneSvg('graphs'));
    expect((await call('graphs', 'identity')).headers.get('content-encoding')).toBeNull();
  });

  it('serves every topic’s scene and the fallback, and 404s anything else', async () => {
    for (const slug of ['arrays-hashing', 'two-pointers', 'binary-search', 'sliding-window', 'recursion', 'sorting', 'dynamic-programming', 'heaps-greedy', 'fallback']) {
      const res = await call(slug);
      expect(res.status, slug).toBe(200);
      expect((await res.text()).startsWith("<svg class='")).toBe(true);
    }
    expect(await (await call('fallback')).text()).toBe(sceneSvg('not-a-topic'));
    expect((await call('not-a-topic')).status).toBe(404);
    expect((await call('')).status).toBe(404);
  });
});
