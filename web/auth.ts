import NextAuth, { CredentialsSignin, type NextAuthConfig } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { clientIp, consume, reset, LOGIN_PER_EMAIL, LOGIN_PER_IP } from '@/lib/rateLimit';

/**
 * Thrown from authorize() when the caller is over the login rate limit. The
 * `code` reaches the client as `result.code`, so the form can say "too many
 * attempts" instead of the generic "invalid email or password".
 */
class RateLimited extends CredentialsSignin {
  code = 'rate_limited';
}

/**
 * Auth.js v5 configuration.
 *
 * Session strategy is JWT — required for the Credentials provider, and it
 * keeps session reads off the database on every request. The PrismaAdapter
 * still persists users/accounts for OAuth providers.
 *
 * Providers:
 *   · Credentials — real email/password. authorize() looks the user up by
 *     email and verifies the bcrypt hash. Accounts are created by the
 *     sign-up server action (app/auth/actions.ts), not here. Works in dev
 *     and prod, no OAuth app required.
 *   · GitHub / Google — only when their env vars are set.
 *
 * AUTH_SECRET is mandatory in production.
 */
const providers: NextAuthConfig['providers'] = [
  Credentials({
    name: 'Email',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(creds, request) {
      const email = String(creds?.email ?? '').trim().toLowerCase();
      const password = String(creds?.password ?? '');
      if (!email || !password) return null;

      // Two buckets: per source address (one attacker, many accounts) and per
      // target email (many addresses, one account). Counted before the bcrypt
      // compare so a locked-out caller costs nothing.
      const ip = clientIp(request.headers);
      const byIp = consume(`login:ip:${ip}`, LOGIN_PER_IP.limit, LOGIN_PER_IP.windowMs);
      const byEmail = consume(`login:email:${email}`, LOGIN_PER_EMAIL.limit, LOGIN_PER_EMAIL.windowMs);
      if (!byIp.ok || !byEmail.ok) throw new RateLimited();

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user?.passwordHash) return null; // no such user, or OAuth-only

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) return null;

      reset(`login:email:${email}`);
      return { id: user.id, email: user.email, name: user.name };
    },
  }),
];

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
  // Self-hosted deployment behind our own host/proxy: there is no vendor
  // platform setting AUTH_URL for us, so Auth.js must trust the incoming
  // Host header or every /api/auth/* call throws UntrustedHost in prod.
  trustHost: true,
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
