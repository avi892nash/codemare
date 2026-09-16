import 'server-only';

/**
 * In-memory sliding-window rate limiter for the auth entry points.
 *
 * State lives in this process, which is correct for the single-instance
 * deployment (one `next start` behind the proxy). If the web app is ever
 * scaled to several instances, swap `consume` for a Redis-backed version —
 * the call sites don't need to change.
 */

const hits = new Map<string, number[]>();
let lastSweep = Date.now();
const SWEEP_EVERY_MS = 60_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the oldest hit in the window expires (only when !ok). */
  retryAfterSec: number;
}

/**
 * Record one attempt under `key` and report whether it is within `limit`
 * attempts per `windowMs`.
 */
export function consume(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const fresh = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    hits.set(key, fresh);
    return { ok: false, retryAfterSec: Math.ceil((fresh[0] + windowMs - now) / 1000) };
  }
  fresh.push(now);
  hits.set(key, fresh);
  return { ok: true, retryAfterSec: 0 };
}

/** Forget every attempt under `key` — e.g. after a successful login. */
export function reset(key: string): void {
  hits.delete(key);
}

/** Drop keys whose every hit is older than the longest window we use. */
function sweep(now: number): void {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, times] of hits) {
    if (times.every((t) => now - t > LONGEST_WINDOW_MS)) hits.delete(key);
  }
}

/**
 * Best-effort client address. Behind our proxy the first x-forwarded-for
 * entry is the client; without a proxy there is no header and every caller
 * shares one bucket, which is the safe direction to fail.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return headers.get('x-real-ip')?.trim() || 'unknown';
}

export function retryMessage(retryAfterSec: number): string {
  const min = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Too many attempts. Try again in ${min} minute${min === 1 ? '' : 's'}.`;
}

export const LOGIN_PER_IP = { limit: 10, windowMs: 15 * 60_000 };
export const LOGIN_PER_EMAIL = { limit: 5, windowMs: 15 * 60_000 };
export const SIGNUP_PER_IP = { limit: 5, windowMs: 60 * 60_000 };
const LONGEST_WINDOW_MS = SIGNUP_PER_IP.windowMs;
