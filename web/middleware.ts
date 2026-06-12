import { auth } from '@/auth';
import { NextResponse } from 'next/server';

/**
 * Login wall: every app route requires a signed-in user. Unauthenticated
 * visitors are redirected to /auth (which is the only public page). Auth.js's
 * own /api/auth/* routes and static assets are excluded by the matcher below.
 */
const PUBLIC_PREFIXES = ['/auth'];

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

  if (!req.auth) {
    const url = new URL('/auth', req.nextUrl.origin);
    if (path !== '/') url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)$).*)'],
};
