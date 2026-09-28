import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';
import type { MailMessage, MailResult } from '@/lib/mailer';
import {
  FORGOT_PER_EMAIL,
  FORGOT_PER_IP,
  RESET_TOKEN_TTL_MINUTES,
  appOrigin,
  checkResetToken,
  generateResetToken,
  hashResetToken,
  isWellFormedResetToken,
  issuePasswordReset,
  passwordResetEmail,
  resetIdentifier,
  resetPasswordWithToken,
  throttleForgot,
} from './passwordReset';
import { prisma, setupTestDatabase } from './test/db';
import { makeUser } from './test/factories';

setupTestDatabase();

const ORIGIN = 'https://codemare.test';

function mailbox() {
  const sent: MailMessage[] = [];
  const send = vi.fn(async (m: MailMessage): Promise<MailResult> => {
    sent.push(m);
    return { transport: 'console', id: null };
  });
  return { sent, send };
}

const tokenIn = (m: MailMessage) => m.text.match(/\/reset\?token=([A-Za-z0-9_-]+)/)![1];

async function issue(email: string, now = new Date()) {
  const box = mailbox();
  const res = await issuePasswordReset(email, { origin: ORIGIN, now, send: box.send });
  return { ...res, box, token: box.sent[0] ? tokenIn(box.sent[0]) : null };
}

describe('issuePasswordReset', () => {
  it('stores only the hash of a 30-minute token and mails the raw link', async () => {
    const user = await makeUser({ email: 'ada@test.dev' });
    const now = new Date('2026-09-28T10:00:00Z');
    const { issued, box, token } = await issue('  ADA@test.dev ', now);

    expect(issued).toBe(true);
    expect(box.send).toHaveBeenCalledTimes(1);
    expect(box.sent[0].to).toBe(user.email);
    expect(box.sent[0].text).toContain(`${ORIGIN}/reset?token=${token}`);
    expect(isWellFormedResetToken(token)).toBe(true);

    const rows = await prisma.verificationToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].identifier).toBe('reset:ada@test.dev');
    expect(rows[0].token).toBe(hashResetToken(token!));
    expect(rows[0].token).not.toContain(token!);
    expect(rows[0].expires.getTime() - now.getTime()).toBe(RESET_TOKEN_TTL_MINUTES * 60_000);
  });

  it('does nothing (and sends nothing) for an unknown email', async () => {
    await makeUser({ email: 'ada@test.dev' });
    const { issued, box } = await issue('nobody@test.dev');
    expect(issued).toBe(false);
    expect(box.send).not.toHaveBeenCalled();
    expect(await prisma.verificationToken.count()).toBe(0);
  });

  it('revokes the previous link when a new one is issued', async () => {
    await makeUser({ email: 'ada@test.dev' });
    const first = await issue('ada@test.dev');
    const second = await issue('ada@test.dev');
    expect(first.token).not.toBe(second.token);
    expect((await checkResetToken(first.token)).ok).toBe(false);
    expect(await checkResetToken(second.token)).toMatchObject({ ok: true, email: 'ada@test.dev' });
    expect(await prisma.verificationToken.count()).toBe(1);
  });
});

describe('checkResetToken', () => {
  it('tells valid, unknown, malformed and expired tokens apart', async () => {
    await makeUser({ email: 'ada@test.dev' });
    const now = new Date('2026-09-28T10:00:00Z');
    const { token } = await issue('ada@test.dev', now);

    expect(await checkResetToken(token, now)).toMatchObject({ ok: true, email: 'ada@test.dev' });
    expect(await checkResetToken(generateResetToken(), now)).toEqual({ ok: false, reason: 'invalid' });
    expect(await checkResetToken('short', now)).toEqual({ ok: false, reason: 'invalid' });
    expect(await checkResetToken(undefined, now)).toEqual({ ok: false, reason: 'invalid' });
    const later = new Date(now.getTime() + RESET_TOKEN_TTL_MINUTES * 60_000);
    expect(await checkResetToken(token, later)).toEqual({ ok: false, reason: 'expired' });
  });

  it('ignores verification tokens that are not reset tokens', async () => {
    const raw = generateResetToken();
    await prisma.verificationToken.create({
      data: { identifier: 'ada@test.dev', token: hashResetToken(raw), expires: new Date(Date.now() + 60_000) },
    });
    expect(await checkResetToken(raw)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('resetPasswordWithToken', () => {
  it('sets a new bcrypt hash, verifies the email and consumes every reset token', async () => {
    const user = await makeUser({ email: 'ada@test.dev' });
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword('old-password') } });
    const { token } = await issue('ada@test.dev');

    const res = await resetPasswordWithToken(token, 'brand-new-password');
    expect(res).toEqual({ ok: true, email: 'ada@test.dev' });

    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword('brand-new-password', fresh.passwordHash!)).toBe(true);
    expect(await verifyPassword('old-password', fresh.passwordHash!)).toBe(false);
    expect(fresh.emailVerified).toBeInstanceOf(Date);
    expect(await prisma.verificationToken.count({ where: { identifier: resetIdentifier('ada@test.dev') } })).toBe(0);

    // Single use.
    expect(await resetPasswordWithToken(token, 'another-password')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a weak password without spending the token', async () => {
    await makeUser({ email: 'ada@test.dev' });
    const { token } = await issue('ada@test.dev');
    expect(await resetPasswordWithToken(token, 'short')).toMatchObject({ ok: false, reason: 'weak_password' });
    expect((await checkResetToken(token)).ok).toBe(true);
  });

  it('rejects an expired token and cleans it up', async () => {
    await makeUser({ email: 'ada@test.dev' });
    const past = new Date(Date.now() - 2 * RESET_TOKEN_TTL_MINUTES * 60_000);
    const { token } = await issue('ada@test.dev', past);
    expect(await resetPasswordWithToken(token, 'brand-new-password')).toMatchObject({ ok: false, reason: 'expired' });
    expect(await prisma.verificationToken.count()).toBe(0);
  });

  it('lets exactly one of two concurrent resets win', async () => {
    await makeUser({ email: 'ada@test.dev' });
    const { token } = await issue('ada@test.dev');
    const results = await Promise.all([
      resetPasswordWithToken(token, 'first-password-1'),
      resetPasswordWithToken(token, 'second-password-2'),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('throttleForgot', () => {
  it('reports the per-IP limit, and goes quiet past the per-email limit', () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < FORGOT_PER_IP.limit; i++) {
      expect(throttleForgot(ip, `ip-test-${i}@test.dev`)).toEqual({ allowed: true, send: true });
    }
    expect(throttleForgot(ip, 'ip-test-x@test.dev')).toMatchObject({ allowed: false });

    const email = `quiet-${Date.now()}@test.dev`;
    const results = Array.from({ length: FORGOT_PER_EMAIL.limit + 1 }, (_, i) => throttleForgot(`198.51.100.${i}`, email));
    expect(results.slice(0, FORGOT_PER_EMAIL.limit).every((r) => r.allowed && r.send)).toBe(true);
    // Same answer for the caller, but nothing is sent.
    expect(results[FORGOT_PER_EMAIL.limit]).toEqual({ allowed: true, send: false });
  });
});

describe('appOrigin', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('prefers AUTH_URL (or NEXTAUTH_URL), whatever the request says', () => {
    expect(appOrigin(h({ host: 'evil.com' }), { AUTH_URL: 'https://codemare.dev/api/auth' })).toBe('https://codemare.dev');
    expect(appOrigin(h({ host: 'evil.com' }), { NEXTAUTH_URL: 'https://codemare.dev' })).toBe('https://codemare.dev');
  });

  it('falls back to the request host', () => {
    expect(appOrigin(h({ host: 'localhost:4001' }), {})).toBe('http://localhost:4001');
    expect(appOrigin(h({ host: 'cm.localhost:4202' }), {})).toBe('http://cm.localhost:4202');
    expect(appOrigin(h({ host: 'codemare.dev' }), {})).toBe('https://codemare.dev');
    expect(appOrigin(h({ 'x-forwarded-host': 'app.codemare.dev', 'x-forwarded-proto': 'https', host: 'web:3000' }), {})).toBe(
      'https://app.codemare.dev'
    );
    expect(appOrigin(h({ host: 'codemare.dev' }), { AUTH_URL: 'not a url' })).toBe('https://codemare.dev');
  });
});

describe('passwordResetEmail', () => {
  it('carries the link and the expiry, with the HTML part escaped', () => {
    const mail = passwordResetEmail('https://codemare.test/reset?token=a&b=<c>');
    expect(mail.subject).toMatch(/reset/i);
    expect(mail.text).toContain('https://codemare.test/reset?token=a&b=<c>');
    expect(mail.text).toContain(`${RESET_TOKEN_TTL_MINUTES} minutes`);
    expect(mail.html).toContain('href="https://codemare.test/reset?token=a&amp;b=&lt;c&gt;"');
    expect(mail.html).not.toContain('<c>');
  });
});
