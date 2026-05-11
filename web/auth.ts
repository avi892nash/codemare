import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

/**
 * Auth.js v5 configuration.
 *
 * Providers are configured but only enabled when their env vars are set, so
 * dev can run with just GitHub (or nothing) without 500s on the sign-in page.
 * AUTH_SECRET is mandatory in production.
 *
 * The PrismaAdapter persists User / Account / Session / VerificationToken
 * to Postgres via the schema in prisma/schema.prisma.
 */
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

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers,
  session: { strategy: 'database' },
  pages: {
    signIn: '/auth',
  },
  callbacks: {
    async session({ session, user }) {
      // Surface the DB-side user id on the session so client code can
      // associate submissions to the signed-in user.
      if (session.user) {
        session.user.id = user.id;
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
