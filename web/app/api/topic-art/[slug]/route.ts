import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { TOPIC_SLUGS } from '@/components/TopicArt/art';
import { sceneSvg } from '@/components/TopicArt/TopicArt';

/**
 * The topic scenes' svgs, one URL each, for the art that loads lazily (the
 * map's card thumbnails: components/TopicArt/ArtInView.tsx). Served with a
 * one-year immutable cache; the URL carries the scene's fingerprint (`?v=`,
 * TopicArt's sceneSrc), so a changed drawing is a new URL. `fallback` is the
 * scene of any topic without art of its own. Behind the login wall like every
 * /api route.
 *
 * Compressed here, once per scene: a route handler's response is not run
 * through the server's compression (the ten scenes would be about 80 KB on the
 * wire against about 9 KB brotli-compressed), so it picks brotli or gzip from
 * Accept-Encoding itself. That makes it dynamic.
 */
export const dynamic = 'force-dynamic';

const SLUGS = new Set<string>([...TOPIC_SLUGS, 'fallback']);
const packed = new Map<string, { br: Buffer; gzip: Buffer }>();

function pack(slug: string, svg: string) {
  let p = packed.get(slug);
  if (!p) {
    const raw = Buffer.from(svg);
    p = { br: brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }), gzip: gzipSync(raw, { level: 9 }) };
    packed.set(slug, p);
  }
  return p;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUGS.has(slug)) return new Response('Not found', { status: 404 });
  const svg = sceneSvg(slug === 'fallback' ? '' : slug);
  const accepts = request.headers.get('accept-encoding') ?? '';
  const encoding = /\bbr\b/.test(accepts) ? 'br' : /\bgzip\b/.test(accepts) ? 'gzip' : null;
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=31536000, immutable',
    Vary: 'Accept-Encoding',
  };
  if (!encoding) return new Response(svg, { headers });
  headers['Content-Encoding'] = encoding;
  return new Response(new Uint8Array(pack(slug, svg)[encoding]), { headers });
}
