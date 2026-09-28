import type { NextAuthConfig } from 'next-auth';
import { isRole } from '@/lib/server/rules/roles';

/**
 * The Edge-safe half of the Auth.js config, shared by the middleware and by
 * `auth.ts`. The middleware only needs to decode the session JWT; importing
 * `auth.ts` there would drag bcryptjs, Prisma and the Credentials provider
 * into the Edge bundle for nothing. Everything Node-only (providers, the
 * Prisma adapter, the role refresh on `update`) lives in `auth.ts`.
 */
export const authConfig = {
  // Self-hosted behind our own proxy: no vendor platform sets AUTH_URL, so
  // Auth.js must trust the incoming Host or every call throws UntrustedHost.
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/signin',
    // Auth.js errors land on the sign-in page as ?error=<code>.
    error: '/signin',
  },
  providers: [],
  callbacks: {
    // id, role and handle ride in the JWT so server code can join on the id
    // and gate routes on the role without a database read.
    jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        token.role = isRole(user.role) ? user.role : 'learner';
        if (user.handle) token.handle = user.handle;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.uid) {
        session.user.id = token.uid;
        session.user.role = token.role ?? 'learner';
        session.user.handle = token.handle ?? '';
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
