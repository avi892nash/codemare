import { auth } from '@/auth';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

/**
 * Login wall: every app route requires a signed-in user. Unauthenticated
 * visitors are redirected to /auth (which is the only public page). Auth.js's
 * own /api/auth/* routes and static assets are excluded by the matcher below.
 */
const PUBLIC_PREFIXES = ['/auth'];

function isPublicPath(path: string): boolean {
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

function redirectToAuth(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const url = new URL('/auth', req.nextUrl.origin);
  if (path !== '/') url.searchParams.set('next', path);
  return NextResponse.redirect(url);
}

const withAuth = auth((req) => {
  const path = req.nextUrl.pathname;
  if (isPublicPath(path)) return NextResponse.next();

  if (!req.auth) return redirectToAuth(req);
  return NextResponse.next();
});

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  try {
    return await (withAuth as unknown as (
      req: NextRequest,
      event: NextFetchEvent
    ) => Promise<Response>)(req, event);
  } catch (err) {
    // Fail CLOSED: if session resolution throws (misconfig, JWT decode error,
    // Auth.js internals), treat the request as unauthenticated rather than
    // letting protected pages through. Public pages stay reachable so users
    // can still get to the login screen.
    console.error('[middleware] auth resolution failed, treating request as unauthenticated:', err);
    if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();
    return redirectToAuth(req);
  }
}

export const config = {
  // Everything is behind the wall by default. Only exclude what MUST be open:
  // Next internals, static assets, the favicon, and Auth.js's own /api/auth/*
  // endpoints (sign-in cannot work if those are walled). All other /api routes
  // — present and future — go through the auth check.
  matcher: ['/((?!_next|api/auth|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)$).*)'],
};
