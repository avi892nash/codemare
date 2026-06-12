import 'server-only';
import bcrypt from 'bcryptjs';

/**
 * Password hashing for email/password auth. bcryptjs is pure-JS (no native
 * build), so it ships anywhere — Vercel, a VM, a container — without a
 * compile step. Cost 12 is a sane default in 2026.
 */
const COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimum policy enforced at sign-up. Keep in sync with the client hint. */
export function validatePassword(plain: string): string | null {
  if (plain.length < 8) return 'Password must be at least 8 characters';
  if (plain.length > 200) return 'Password is too long';
  return null;
}
