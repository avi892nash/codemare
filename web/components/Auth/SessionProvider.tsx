'use client';

import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react';
import type { Session } from 'next-auth';

/**
 * Thin client wrapper around Auth.js's SessionProvider. Mounted once in the
 * root layout so any client component (AuthForm, profile menu, etc.) can
 * call useSession() / signIn() / signOut().
 */
export function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session | null;
}) {
  return <NextAuthSessionProvider session={session}>{children}</NextAuthSessionProvider>;
}
