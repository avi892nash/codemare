'use server';

import { prisma } from '@/lib/prisma';
import { hashPassword, validatePassword } from '@/lib/password';

export interface SignUpResult {
  ok: boolean;
  error?: string;
}

/**
 * Create an email/password account. Validates, checks the email isn't taken,
 * hashes the password, and persists the User. Does NOT sign the user in — the
 * client calls signIn('credentials') after a successful sign-up so the same
 * password path is exercised.
 */
export async function signUp(input: {
  email: string;
  password: string;
  handle?: string;
}): Promise<SignUpResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email' };
  }

  const pwErr = validatePassword(input.password);
  if (pwErr) return { ok: false, error: pwErr };

  const handle = input.handle?.trim() || null;
  if (handle && !/^[a-zA-Z0-9_]{3,24}$/.test(handle)) {
    return { ok: false, error: 'Handle must be 3–24 chars: letters, numbers, underscore' };
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: 'An account with that email already exists' };

  if (handle) {
    const taken = await prisma.user.findUnique({ where: { handle } });
    if (taken) return { ok: false, error: 'That handle is taken' };
  }

  const passwordHash = await hashPassword(input.password);
  await prisma.user.create({
    data: {
      email,
      name: handle ?? email.split('@')[0],
      handle,
      passwordHash,
    },
  });

  return { ok: true };
}
