import NextAuth from 'next-auth';
import { authConfig } from './auth.config';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { decideRoute } from '@/components/Auth/routes';

/**
 * Login wall. Every route needs a signed-in user except the auth pages
 * (/signin, /signup, /forgot, /reset and the legacy /auth alias) and, outside
 * production, /dev/*. The rules live in components/Auth/routes.ts:
 *
 *   · signed out, page     → /signin?next=<path+query>  (`/` → plain /signin)
 *   · signed out, /api/*   → 401 JSON (a fetch or EventSource should not be
 *                            redirected to an HTML page)
 *   · signed in, auth page → the safe `next`, else /problems
 *
 * In production /dev/* stays behind the wall AND 404s (app/dev/layout.tsx).
 * Auth.js's own /api/auth/* routes and static assets skip the middleware
 * entirely (see `config.matcher`).
 */
function respond(req: NextRequest, signedIn: boolean): Response {
  const decision = decideRoute({
    path: req.nextUrl.pathname,
    search: req.nextUrl.search,
    signedIn,
    production: process.env.NODE_ENV === 'production',
  });
  switch (decision.type) {
    case 'next':
      return NextResponse.next();
    case 'unauthorized':
      return NextResponse.json({ error: 'unauthorized', message: 'Sign in first.' }, { status: 401 });
    case 'redirect':
      return NextResponse.redirect(new URL(decision.to, req.nextUrl.origin));
  }
}

// Edge-safe instance: decodes the session JWT only (see auth.config.ts).
const { auth } = NextAuth(authConfig);

const withAuth = auth((req) => respond(req, Boolean(req.auth?.user)));

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  try {
    return await (withAuth as unknown as (req: NextRequest, event: NextFetchEvent) => Promise<Response>)(req, event);
  } catch (err) {
    // Fail CLOSED: if session resolution throws (misconfig, JWT decode error,
    // Auth.js internals), treat the request as signed out rather than letting
    // protected pages through. The auth pages stay reachable, so people can
    // still get to the sign-in screen.
    console.error('[middleware] auth resolution failed, treating request as signed out:', err);
    return respond(req, false);
  }
}

export const config = {
  // Everything is behind the wall by default. Only exclude what MUST be open:
  // Next internals, static assets, the favicon, robots.txt / sitemap.xml, and
  // Auth.js's own /api/auth/* endpoints (sign-in cannot work if those are
  // walled). All other /api routes — present and future — go through the
  // auth check.
  matcher: [
    '/((?!_next|api/auth|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
};
