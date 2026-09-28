import NextAuth, { CredentialsSignin, type NextAuthConfig } from 'next-auth';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
// Brings 'next-auth/jwt' into the program so the JWT augmentation below resolves.
import type {} from 'next-auth/jwt';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { verifyPassword } from '@/lib/password';
import { clientIp, consume, reset, LOGIN_PER_EMAIL, LOGIN_PER_IP } from '@/lib/rateLimit';
import { isRole } from '@/lib/server/rules/roles';
import { createUserWithHandle } from '@/lib/server/users';
import type { Role } from '@/lib/types';

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
 * The JWT (and `session.user`) carry the user's `id`, `role` and `handle`,
 * set at sign-in. Role changes reach an existing session on the next
 * sign-in, or immediately via `unstable_update()` / `useSession().update()`
 * (trigger "update" re-reads the row).
 *
 * Providers:
 *   · Credentials — real email/password. authorize() looks the user up by
 *     email and verifies the bcrypt hash. Accounts are created by the
 *     sign-up server action (app/auth/actions.ts), not here; passwords are
 *     reset through /forgot → /reset (lib/server/passwordReset.ts). Works in
 *     dev and prod, no OAuth app required.
 *   · GitHub / Google — only when their env vars are set. New OAuth users get
 *     a generated handle (GitHub login, else name, else email).
 *
 * AUTH_SECRET is mandatory in production.
 */
/**
 * Which OAuth providers are configured. The auth pages read this on the
 * server to decide which "Continue with …" buttons to render, so a button is
 * never shown for a provider that would fail.
 */
export const oauthProviders = {
  github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
} as const;

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
      return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role, handle: user.handle };
    },
  }),
];

if (oauthProviders.github) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      // The default mapping plus the login, which seeds the generated handle.
      profile(profile) {
        return {
          id: profile.id.toString(),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          handle: profile.login,
        };
      },
    })
  );
}
if (oauthProviders.google) {
  providers.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    })
  );
}

/**
 * PrismaAdapter with one override: app.users.handle is NOT NULL, so an OAuth
 * sign-up creates the user with a unique handle generated from the profile.
 */
function codemareAdapter(): Adapter {
  const base = PrismaAdapter(prisma);
  return {
    ...base,
    async createUser(user: AdapterUser) {
      const created = await createUserWithHandle(
        {
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
          emailVerified: user.emailVerified ?? null,
        },
        { seeds: [user.handle, user.name, user.email.split('@')[0]] }
      );
      return created as AdapterUser;
    },
  };
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  adapter: codemareAdapter(),
  providers,
  // Self-hosted deployment behind our own host/proxy: there is no vendor
  // platform setting AUTH_URL for us, so Auth.js must trust the incoming
  // Host header or every /api/auth/* call throws UntrustedHost in prod.
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/signin',
    // Auth.js errors (OAuth failures, AccessDenied, Configuration …) land on
    // the sign-in page as ?error=<code>, which it turns into a message.
    error: '/signin',
  },
  callbacks: {
    // Carry the DB user id, role and handle through the JWT so server code
    // can join on the id and gate routes on the role without a DB read.
    async jwt({ token, user, trigger }) {
      if (user?.id) {
        token.uid = user.id;
        token.role = isRole(user.role) ? user.role : 'learner';
        if (user.handle) token.handle = user.handle;
      }
      if (trigger === 'update' && token.uid) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.uid },
          select: { role: true, handle: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.handle = fresh.handle;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        session.user.id = token.uid;
        session.user.role = token.role ?? 'learner';
        session.user.handle = token.handle ?? '';
      }
      return session;
    },
  },
});

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /** learner < author < staff < admin (hasRole in lib/server/rules/roles). */
      role: Role;
      /** Lowercase public handle (/u/[handle]). */
      handle: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
  interface User {
    role?: Role;
    handle?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    handle?: string;
  }
}
