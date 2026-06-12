import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

/**
 * Auth.js v5 configuration.
 *
 * Session strategy is JWT — required so the dev Credentials provider works,
 * and it keeps session reads off the database on every request. The
 * PrismaAdapter still persists users/accounts for OAuth.
 *
 * Providers are conditional:
 *   · GitHub / Google — only when their env vars are set.
 *   · "Dev login" Credentials — only outside production. Lets you sign in
 *     locally with just an email (a User row is upserted), so the app is
 *     testable without registering an OAuth app. NEVER enabled in prod.
 *
 * AUTH_SECRET is mandatory in production.
 */
const isDev = process.env.NODE_ENV !== 'production';

const providers = [];

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    })
  );
}
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    })
  );
}
if (isDev) {
  providers.push(
    Credentials({
      id: 'dev',
      name: 'Dev login',
      credentials: {
        email: { label: 'Email', type: 'email' },
        name: { label: 'Name', type: 'text' },
      },
      async authorize(creds) {
        const email = String(creds?.email ?? '').trim().toLowerCase();
        if (!email) return null;
        const name = String(creds?.name ?? '').trim() || email.split('@')[0];
        // Upsert a real User row so submissions/profile have something to join.
        const user = await prisma.user.upsert({
          where: { email },
          create: { email, name },
          update: {},
        });
        return { id: user.id, email: user.email, name: user.name };
      },
    })
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth',
  },
  callbacks: {
    // Carry the DB user id through the JWT so server code can join on it.
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
});

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
