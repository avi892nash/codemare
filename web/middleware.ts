import { auth } from '@/auth';
import { NextResponse } from 'next/server';

/**
 * Middleware: gates routes that require a signed-in user. The catalog,
 * problem detail, design system and auth pages stay open — anyone can browse
 * and read. Personal pages (submissions history, profile) redirect to /auth.
 *
 * The matcher below MUST exclude /_next, /api, image / favicon assets, and
 * the public routes, otherwise auth.js itself can't load its OAuth callbacks.
 */
const PROTECTED_PATHS = ['/submissions', '/profile'];

export default auth((req) => {
  const path = req.nextUrl.pathname;
  const needsAuth = PROTECTED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (!needsAuth) return NextResponse.next();

  if (!req.auth) {
    const url = new URL('/auth', req.nextUrl.origin);
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)$).*)'],
};
