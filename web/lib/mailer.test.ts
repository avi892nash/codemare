import { describe, expect, it, vi } from 'vitest';
import { MailDeliveryError, RESEND_ENDPOINT, mailTransport, sendMail } from './mailer';

const msg = { to: 'ada@example.com', subject: 'Reset your password', text: 'Link: https://codemare.test/reset?token=abc', html: '<p>hi</p>' };
const resendEnv = { RESEND_API_KEY: 're_test_123', MAIL_FROM: 'Codemare <noreply@codemare.test>' };

describe('mailTransport', () => {
  it('uses Resend only when both the key and the sender are set', () => {
    expect(mailTransport(resendEnv)).toBe('resend');
    expect(mailTransport({ RESEND_API_KEY: 're_test_123' })).toBe('console');
    expect(mailTransport({ MAIL_FROM: 'x@y.z' })).toBe('console');
    expect(mailTransport({ RESEND_API_KEY: '  ', MAIL_FROM: 'x@y.z' })).toBe('console');
    expect(mailTransport({})).toBe('console');
  });
});

describe('sendMail', () => {
  it('prints the message (link included) when no transport is configured', async () => {
    const lines: string[] = [];
    const fetchMock = vi.fn();
    const res = await sendMail(msg, { env: {}, log: (t) => lines.push(t), fetch: fetchMock });
    expect(res).toEqual({ transport: 'console', id: null });
    expect(fetchMock).not.toHaveBeenCalled();
    const out = lines.join('\n');
    expect(out).toContain('To:      ada@example.com');
    expect(out).toContain('https://codemare.test/reset?token=abc');
    expect(out).not.toMatch(/WARNING/);
  });

  it('warns loudly when production has no transport', async () => {
    const lines: string[] = [];
    await sendMail(msg, { env: { NODE_ENV: 'production' }, log: (t) => lines.push(t) });
    expect(lines.join('\n')).toMatch(/WARNING: no mail transport in production/);
  });

  it('posts to Resend with a bearer key and the message as JSON', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
    const res = await sendMail(msg, { env: resendEnv, fetch: fetchMock as unknown as typeof fetch });
    expect(res).toEqual({ transport: 'resend', id: 'email_1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_123');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'Codemare <noreply@codemare.test>',
      to: ['ada@example.com'],
      subject: 'Reset your password',
      text: msg.text,
      html: '<p>hi</p>',
    });
  });

  it('throws MailDeliveryError on a provider rejection, without leaking the key', async () => {
    const fetchMock = vi.fn(async () => new Response('{"message":"invalid from"}', { status: 422 }));
    const err = await sendMail(msg, { env: resendEnv, fetch: fetchMock as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(MailDeliveryError);
    expect(err.status).toBe(422);
    expect(err.message).toContain('invalid from');
    expect(err.message).not.toContain('re_test_123');
  });

  it('throws MailDeliveryError(0) when the provider is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const err = await sendMail(msg, { env: resendEnv, fetch: fetchMock as unknown as typeof fetch }).catch((e) => e);
    expect(err).toBeInstanceOf(MailDeliveryError);
    expect(err.status).toBe(0);
  });
});
