/**
 * Auth routing rules shared by the middleware (edge), the auth pages (server)
 * and the auth forms (client). Pure: no React, no Node or Next imports.
 *
 *   /signin /signup /forgot /reset   public; signed-in visitors are sent on
 *   /auth                            legacy alias, redirects to /signin
 *   /dev/*                           public outside production
 *   /api/*                           401 JSON when signed out (not a redirect)
 *   everything else                  signed out → /signin?next=<path+query>
 */

export const AUTH_PAGES = ['/signin', '/signup', '/forgot', '/reset'] as const;
export const LEGACY_AUTH_PAGE = '/auth';
/** Where a signed-in visitor lands when there is no usable `next`: the tier map, which is home. */
export const DEFAULT_AFTER_SIGN_IN = '/map';

const under = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

/** An auth page (or the legacy /auth alias). */
export function isAuthPage(path: string): boolean {
  return under(path, LEGACY_AUTH_PAGE) || AUTH_PAGES.some((p) => under(path, p));
}

// Control characters (browsers silently strip tab/CR/LF from URLs, turning
// "/\t/evil.com" into "//evil.com") and backslashes (normalized to "/").
// Built with RegExp so the source stays free of literal control characters.
const UNSAFE_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\\\]');

/**
 * The same-origin path to continue to after signing in, or null when `raw`
 * is missing or unsafe. Only plain absolute paths pass: protocol-relative
 * (`//evil.com`), backslash (`/\evil.com`) and control-character tricks are
 * rejected, and so are the auth pages themselves (they would loop).
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//')) return null;
  if (UNSAFE_CHARS.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw, 'http://codemare.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'http://codemare.invalid' || isAuthPage(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/signin`, carrying `next` when it is safe and not just the home page. */
export function signInHref(next?: string | null, page: '/signin' | '/signup' = '/signin'): string {
  const safe = safeNextPath(next);
  return safe && safe !== '/' ? `${page}?next=${encodeURIComponent(safe)}` : page;
}

export type RouteDecision =
  | { type: 'next' }
  /** Same-origin path (+ query) to redirect to. */
  | { type: 'redirect'; to: string }
  /** Signed-out API call: answer 401 instead of redirecting a fetch to HTML. */
  | { type: 'unauthorized' };

/**
 * What the middleware does with a request. Fail-closed by construction:
 * callers that cannot resolve the session pass `signedIn: false`.
 */
export function decideRoute(input: {
  path: string;
  /** `?a=b` or '' — kept in `next` so the visitor returns to the same view. */
  search: string;
  signedIn: boolean;
  production: boolean;
}): RouteDecision {
  const { path, signedIn } = input;
  if (!input.production && under(path, '/dev')) return { type: 'next' };
  if (isAuthPage(path)) {
    if (!signedIn) return { type: 'next' };
    const next = new URLSearchParams(input.search).get('next');
    return { type: 'redirect', to: safeNextPath(next) ?? DEFAULT_AFTER_SIGN_IN };
  }
  if (signedIn) return { type: 'next' };
  if (under(path, '/api')) return { type: 'unauthorized' };
  return { type: 'redirect', to: path === '/' ? '/signin' : signInHref(`${path}${input.search}`) };
}
