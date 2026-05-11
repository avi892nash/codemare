import type { Request, Response, NextFunction } from 'express';

/**
 * Compile-service auth: a shared-secret token check on every mutating endpoint.
 *
 * The compile service is internal infrastructure — only the trusted backend
 * (Next.js server) should be able to invoke it. The token lives in
 * `INTERNAL_TOKEN` on both sides; callers send it as `X-Codemare-Token`.
 *
 * Dev override: when NODE_ENV !== 'production' AND no token is configured,
 * requests pass without the header. This keeps the legacy Vite dev frontend
 * working until we cut over to the Next.js app. Once the migration is done,
 * unset the dev override by always setting `INTERNAL_TOKEN`.
 *
 * Healthcheck (`/health`) is intentionally exempt — load balancers and systemd
 * need to probe without credentials.
 */

const expectedToken = (process.env.INTERNAL_TOKEN ?? '').trim();
const isDev = process.env.NODE_ENV !== 'production';

if (!expectedToken && !isDev) {
  // Fail loud at module load so a misconfigured prod deploy doesn't silently
  // serve unauthenticated traffic.
  throw new Error(
    'INTERNAL_TOKEN env var is required in production. Set it on the compile ' +
      'service and on every caller (Next.js server, internal scripts).'
  );
}

export function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  if (!expectedToken && isDev) {
    // Open in dev when nothing is configured.
    next();
    return;
  }

  const header = req.header('X-Codemare-Token');
  if (!header) {
    res.status(401).json({ error: 'Missing X-Codemare-Token header' });
    return;
  }

  // Constant-time compare to keep timing-side-channels off the table.
  if (!timingSafeEqual(header, expectedToken)) {
    res.status(403).json({ error: 'Invalid X-Codemare-Token' });
    return;
  }

  next();
}

/**
 * Constant-time string equality. Both inputs are normalised to the longest
 * length so a length mismatch doesn't short-circuit early.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
