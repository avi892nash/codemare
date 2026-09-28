'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword, validatePassword } from '@/lib/password';
import { clientIp, consume, reset, retryMessage, SIGNUP_PER_IP } from '@/lib/rateLimit';
import { HANDLE_INPUT_RE } from '@/lib/server/rules/handles';
import { EmailTaken, HandleTaken, createUserWithHandle, isHandleAvailable } from '@/lib/server/users';
import {
  RESET_PER_IP,
  appOrigin,
  isEmailLike,
  issuePasswordReset,
  normalizeEmail,
  resetPasswordWithToken,
  throttleForgot,
} from '@/lib/server/passwordReset';

/** The form field an error belongs to (the form marks it aria-invalid). */
export type AuthField = 'handle' | 'email' | 'password';

export interface SignUpResult {
  ok: boolean;
  error?: string;
  field?: AuthField;
  /** The account's handle (lowercase) on success. */
  handle?: string;
}

/**
 * Create an email/password account. The username becomes the public handle
 * (validated, lowercased; a clash is reported). Checks the email isn't taken,
 * hashes the password and persists the user. Does NOT sign the user in — the
 * client calls signIn('credentials') after a successful sign-up so the same
 * password path is exercised.
 */
export async function signUp(input: {
  email: string;
  password: string;
  /** The username field: 3–24 letters, digits or underscores (stored lowercased). */
  handle?: string;
  /** Alias of `handle`. */
  username?: string;
}): Promise<SignUpResult> {
  const ip = clientIp(await headers());
  const limit = consume(`signup:ip:${ip}`, SIGNUP_PER_IP.limit, SIGNUP_PER_IP.windowMs);
  if (!limit.ok) return { ok: false, error: retryMessage(limit.retryAfterSec) };

  const username = String(input.handle ?? input.username ?? '').trim();
  if (!username) return { ok: false, field: 'handle', error: 'Choose a username' };
  if (!HANDLE_INPUT_RE.test(username)) {
    return { ok: false, field: 'handle', error: 'Use 3–24 letters, numbers or underscores' };
  }
  const handle = username.toLowerCase();

  const email = normalizeEmail(String(input.email ?? ''));
  if (!isEmailLike(email)) return { ok: false, field: 'email', error: 'Enter a valid email' };

  const password = String(input.password ?? '');
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, field: 'password', error: pwErr };

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, field: 'email', error: 'An account with that email already exists' };
  if (!(await isHandleAvailable(handle))) return { ok: false, field: 'handle', error: 'That username is taken' };

  const passwordHash = await hashPassword(password);
  try {
    const user = await createUserWithHandle({ email, name: username, passwordHash }, { handle });
    return { ok: true, handle: user.handle };
  } catch (e) {
    if (e instanceof HandleTaken) return { ok: false, field: 'handle', error: 'That username is taken' };
    if (e instanceof EmailTaken) return { ok: false, field: 'email', error: 'An account with that email already exists' };
    throw e;
  }
}

export interface ForgotResult {
  ok: boolean;
  error?: string;
  field?: AuthField;
}

/**
 * "Forgot password": always answers the same for a well-formed email,
 * whether or not an account exists. The lookup, token and email happen after
 * the response is sent (next/server `after`), so response time doesn't leak
 * it either. Rate-limited per IP (reported) and per email (silent).
 */
export async function requestPasswordReset(input: { email: string }): Promise<ForgotResult> {
  const email = normalizeEmail(String(input?.email ?? ''));
  if (!isEmailLike(email)) return { ok: false, field: 'email', error: 'Enter a valid email' };

  const h = await headers();
  const gate = throttleForgot(clientIp(h), email);
  if (!gate.allowed) return { ok: false, error: retryMessage(gate.retryAfterSec) };

  if (gate.send) {
    const origin = appOrigin(h);
    after(async () => {
      try {
        await issuePasswordReset(email, { origin });
      } catch (e) {
        console.error('[forgot] could not issue a password reset link:', e);
      }
    });
  }
  return { ok: true };
}

export interface ResetResultForm {
  ok: boolean;
  error?: string;
  field?: AuthField;
  /** The link itself is unusable (invalid, used or expired): offer a new one. */
  linkDead?: boolean;
  /** The account's email on success, so the client can sign straight in. */
  email?: string;
}

/** Set a new password from a /reset link. */
export async function resetPassword(input: { token: string; password: string }): Promise<ResetResultForm> {
  const h = await headers();
  const ip = clientIp(h);
  const limit = consume(`reset:ip:${ip}`, RESET_PER_IP.limit, RESET_PER_IP.windowMs);
  if (!limit.ok) return { ok: false, error: retryMessage(limit.retryAfterSec) };

  const result = await resetPasswordWithToken(input?.token, String(input?.password ?? ''));
  if (!result.ok) {
    return result.reason === 'weak_password'
      ? { ok: false, field: 'password', error: result.message }
      : { ok: false, linkDead: true, error: result.message };
  }
  // The owner just proved control of the inbox: lift any sign-in lockout so
  // the new password works right away.
  reset(`login:email:${result.email}`);
  return { ok: true, email: result.email };
}
