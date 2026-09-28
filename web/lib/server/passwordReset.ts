import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { hashPassword, validatePassword } from '@/lib/password';
import { consume } from '@/lib/rateLimit';
import { sendMail, type MailMessage, type MailResult } from '@/lib/mailer';
import { prisma } from './db';

/**
 * Password reset (spec §2: tokens live in app.verification_tokens with
 * identifier `reset:<email>`).
 *
 *   /forgot  → throttleForgot (in the request) → issuePasswordReset (after
 *              the response, so timing never reveals whether the account
 *              exists) → mail with /reset?token=<raw>
 *   /reset   → checkResetToken (page render) → resetPasswordWithToken
 *
 * Only the SHA-256 of a token is stored: a leaked table cannot be replayed
 * into working links. A token is single-use, expires after 30 minutes, and
 * issuing a new one revokes the older ones for that email.
 */

export const RESET_TOKEN_TTL_MINUTES = 30;
const TTL_MS = RESET_TOKEN_TTL_MINUTES * 60_000;
export const RESET_IDENTIFIER_PREFIX = 'reset:';

/** Per source address: over it, /forgot answers "too many attempts". */
export const FORGOT_PER_IP = { limit: 5, windowMs: 15 * 60_000 };
/** Per target email: over it, /forgot answers as usual but sends nothing. */
export const FORGOT_PER_EMAIL = { limit: 3, windowMs: 60 * 60_000 };
/** Reset submissions per source address. */
export const RESET_PER_IP = { limit: 10, windowMs: 15 * 60_000 };

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isEmailLike(email: string): boolean {
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export function resetIdentifier(email: string): string {
  return `${RESET_IDENTIFIER_PREFIX}${normalizeEmail(email)}`;
}

/** What is stored for a raw token. */
export function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 256 random bits, base64url (43 characters). */
export function generateResetToken(): string {
  return randomBytes(32).toString('base64url');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Shape check before touching the database. */
export function isWellFormedResetToken(raw: unknown): raw is string {
  return typeof raw === 'string' && TOKEN_RE.test(raw);
}

// ─── /forgot ─────────────────────────────────────────────────────────────

export type ForgotGate = { allowed: true; send: boolean } | { allowed: false; retryAfterSec: number };

/**
 * Rate limits for a reset request, counted before any account lookup so they
 * behave the same whether or not the email has an account. Over the per-IP
 * limit the caller reports "too many attempts"; over the per-email limit it
 * answers exactly as usual but sends nothing (no inbox flooding, and no
 * signal to whoever is asking).
 */
export function throttleForgot(ip: string, email: string): ForgotGate {
  const byIp = consume(`forgot:ip:${ip}`, FORGOT_PER_IP.limit, FORGOT_PER_IP.windowMs);
  if (!byIp.ok) return { allowed: false, retryAfterSec: byIp.retryAfterSec };
  const byEmail = consume(`forgot:email:${normalizeEmail(email)}`, FORGOT_PER_EMAIL.limit, FORGOT_PER_EMAIL.windowMs);
  return { allowed: true, send: byEmail.ok };
}

/**
 * The public origin reset links point at: AUTH_URL (or NEXTAUTH_URL) when
 * set, else the request's own host. Set AUTH_URL in production so a spoofed
 * Host header can never shape the link.
 */
export function appOrigin(h: Headers, env: Record<string, string | undefined> = process.env): string {
  for (const configured of [env.AUTH_URL, env.NEXTAUTH_URL]) {
    if (!configured?.trim()) continue;
    try {
      return new URL(configured.trim()).origin;
    } catch {
      // Malformed: fall through to the request host.
    }
  }
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host')?.trim() || 'localhost';
  const hostname = host.replace(/:\d+$/, '');
  const local = hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname) || hostname === '[::1]';
  const proto = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || (local ? 'http' : 'https');
  return `${proto}://${host}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The reset email. Plain text first; the HTML part stays unstyled. */
export function passwordResetEmail(link: string): Omit<MailMessage, 'to'> {
  const text = [
    'Someone asked to reset the password for your Codemare account.',
    '',
    'Choose a new password here:',
    link,
    '',
    `The link works once and expires in ${RESET_TOKEN_TTL_MINUTES} minutes. Requesting another link cancels this one.`,
    "If you didn't ask for this, ignore this email. Your password stays the same.",
  ].join('\n');
  const href = escapeHtml(link);
  const html = [
    '<p>Someone asked to reset the password for your Codemare account.</p>',
    `<p><a href="${href}">Choose a new password</a></p>`,
    `<p>Or paste this link into your browser:<br>${href}</p>`,
    `<p>The link works once and expires in ${RESET_TOKEN_TTL_MINUTES} minutes. Requesting another link cancels this one.</p>`,
    "<p>If you didn't ask for this, ignore this email. Your password stays the same.</p>",
  ].join('\n');
  return { subject: 'Reset your Codemare password', text, html };
}

export interface IssueResult {
  /** False when no account has this email (nothing stored, nothing sent). */
  issued: boolean;
  expires?: Date;
  mail?: MailResult;
}

/**
 * Issue a reset link for `email` if an account has it: revoke earlier reset
 * tokens for the email, store the hash of a fresh token (30-minute expiry)
 * and mail `<origin>/reset?token=<raw>`. Unknown emails are a silent no-op —
 * callers must answer identically either way.
 */
export async function issuePasswordReset(
  emailRaw: string,
  opts: { origin: string; now?: Date; send?: (msg: MailMessage) => Promise<MailResult> }
): Promise<IssueResult> {
  const email = normalizeEmail(emailRaw);
  if (!isEmailLike(email)) return { issued: false };
  const user = await prisma.user.findUnique({ where: { email }, select: { email: true } });
  if (!user) return { issued: false };

  const raw = generateResetToken();
  const expires = new Date((opts.now ?? new Date()).getTime() + TTL_MS);
  const identifier = resetIdentifier(email);
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({ data: { identifier, token: hashResetToken(raw), expires } }),
  ]);

  const link = `${opts.origin.replace(/\/+$/, '')}/reset?token=${raw}`;
  const mail = await (opts.send ?? sendMail)({ to: user.email, ...passwordResetEmail(link) });
  return { issued: true, expires, mail };
}

// ─── /reset ──────────────────────────────────────────────────────────────

export type ResetTokenState =
  | { ok: true; email: string; expires: Date }
  | { ok: false; reason: 'invalid' | 'expired' };

/** Is this raw token a live reset token? (Read-only.) */
export async function checkResetToken(raw: unknown, now: Date = new Date()): Promise<ResetTokenState> {
  if (!isWellFormedResetToken(raw)) return { ok: false, reason: 'invalid' };
  const row = await prisma.verificationToken.findUnique({ where: { token: hashResetToken(raw) } });
  if (!row || !row.identifier.startsWith(RESET_IDENTIFIER_PREFIX)) return { ok: false, reason: 'invalid' };
  if (row.expires.getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true, email: row.identifier.slice(RESET_IDENTIFIER_PREFIX.length), expires: row.expires };
}

export type ResetFailure = 'invalid' | 'expired' | 'weak_password';

export type ResetResult = { ok: true; email: string } | { ok: false; reason: ResetFailure; message: string };

const FAILURE_MESSAGE: Record<Exclude<ResetFailure, 'weak_password'>, string> = {
  invalid: 'This reset link is invalid or has already been used.',
  expired: 'This reset link has expired.',
};

/**
 * Set a new password with a reset token: validates the password, then in one
 * transaction consumes the token (only one concurrent use can win), stores
 * the new bcrypt hash, marks the email verified (the link proved ownership)
 * and revokes every other reset token for the email.
 */
export async function resetPasswordWithToken(raw: unknown, password: string, now: Date = new Date()): Promise<ResetResult> {
  const weak = validatePassword(password);
  if (weak) return { ok: false, reason: 'weak_password', message: weak };

  const state = await checkResetToken(raw, now);
  if (!state.ok) {
    if (state.reason === 'expired') {
      await prisma.verificationToken.deleteMany({ where: { token: hashResetToken(raw as string) } });
    }
    return { ok: false, reason: state.reason, message: FAILURE_MESSAGE[state.reason] };
  }

  // bcrypt is deliberately slow: hash before opening the transaction.
  const passwordHash = await hashPassword(password);
  const identifier = resetIdentifier(state.email);
  return prisma.$transaction(async (tx): Promise<ResetResult> => {
    const consumed = await tx.verificationToken.deleteMany({
      where: { token: hashResetToken(raw as string), identifier, expires: { gt: now } },
    });
    if (consumed.count !== 1) return { ok: false, reason: 'invalid', message: FAILURE_MESSAGE.invalid };

    const updated = await tx.user.updateMany({ where: { email: state.email }, data: { passwordHash } });
    if (updated.count !== 1) return { ok: false, reason: 'invalid', message: FAILURE_MESSAGE.invalid };
    await tx.user.updateMany({ where: { email: state.email, emailVerified: null }, data: { emailVerified: now } });
    await tx.verificationToken.deleteMany({ where: { identifier } });
    return { ok: true, email: state.email };
  });
}
