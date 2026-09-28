'use server';

import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { hashPassword, validatePassword } from '@/lib/password';
import { clientIp, consume, retryMessage, SIGNUP_PER_IP } from '@/lib/rateLimit';
import { HANDLE_INPUT_RE } from '@/lib/server/rules/handles';
import { EmailTaken, HandleTaken, createUserWithHandle, isHandleAvailable } from '@/lib/server/users';

export interface SignUpResult {
  ok: boolean;
  error?: string;
  /** The account's handle (lowercase) on success. */
  handle?: string;
}

/**
 * Create an email/password account. Validates, checks the email isn't taken,
 * hashes the password, and persists the User with a unique lowercase handle:
 * the username field (`handle`, or `username`) lowercased when given — a clash
 * is reported — otherwise one generated from the email. Does NOT sign the
 * user in — the client calls signIn('credentials') after a successful
 * sign-up so the same password path is exercised.
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

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email' };
  }

  const pwErr = validatePassword(input.password);
  if (pwErr) return { ok: false, error: pwErr };

  const username = (input.handle ?? input.username ?? '').trim();
  if (username && !HANDLE_INPUT_RE.test(username)) {
    return { ok: false, error: 'Handle must be 3–24 chars: letters, numbers, underscore' };
  }
  const handle = username ? username.toLowerCase() : undefined;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, error: 'An account with that email already exists' };
  if (handle && !(await isHandleAvailable(handle))) return { ok: false, error: 'That handle is taken' };

  const passwordHash = await hashPassword(input.password);
  const localPart = email.split('@')[0];
  try {
    const user = await createUserWithHandle(
      { email, name: username || localPart, passwordHash },
      handle ? { handle } : { seeds: [localPart] }
    );
    return { ok: true, handle: user.handle };
  } catch (e) {
    if (e instanceof HandleTaken) return { ok: false, error: 'That handle is taken' };
    if (e instanceof EmailTaken) return { ok: false, error: 'An account with that email already exists' };
    throw e;
  }
}
