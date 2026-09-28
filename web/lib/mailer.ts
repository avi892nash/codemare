import 'server-only';

/**
 * Outgoing mail (password-reset links today). One transport, over plain
 * fetch — no SMTP library:
 *
 *   · resend   RESEND_API_KEY and MAIL_FROM both set → POST to Resend's HTTP
 *              API (https://resend.com/docs/api-reference/emails/send-email).
 *   · console  otherwise → the message, link included, is printed to the
 *              server console (`next dev` / `next start` output). This is the
 *              development default; in production it logs a warning too.
 *
 * The API key is only ever sent in the Authorization header, never logged.
 */

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body; always sent. */
  text: string;
  html?: string;
}

export type MailTransport = 'resend' | 'console';

export interface MailResult {
  transport: MailTransport;
  /** The provider's message id (resend), else null. */
  id: string | null;
}

/** The provider rejected the message or could not be reached. */
export class MailDeliveryError extends Error {
  constructor(
    /** HTTP status from the provider; 0 when it could not be reached. */
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export interface MailerEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  NODE_ENV?: string;
}

export interface MailerDeps {
  env?: MailerEnv;
  fetch?: typeof fetch;
  /** Console transport sink (tests capture it). */
  log?: (text: string) => void;
}

/** Which transport `sendMail` will use with this environment. */
export function mailTransport(env: MailerEnv = process.env): MailTransport {
  return env.RESEND_API_KEY?.trim() && env.MAIL_FROM?.trim() ? 'resend' : 'console';
}

/**
 * Send one message. Resolves with the transport used; throws
 * MailDeliveryError when Resend rejects it or cannot be reached.
 */
export async function sendMail(msg: MailMessage, deps: MailerDeps = {}): Promise<MailResult> {
  const env = deps.env ?? process.env;

  if (mailTransport(env) === 'console') {
    const log = deps.log ?? ((text: string) => console.info(text));
    const warning =
      env.NODE_ENV === 'production'
        ? 'WARNING: no mail transport in production (set RESEND_API_KEY and MAIL_FROM). '
        : '';
    log(
      [
        `[mail] ${warning}RESEND_API_KEY / MAIL_FROM not set, so this message is printed instead of sent.`,
        `  To:      ${msg.to}`,
        `  Subject: ${msg.subject}`,
        '',
        ...msg.text.split('\n').map((line) => `  ${line}`),
      ].join('\n')
    );
    return { transport: 'console', id: null };
  }

  const doFetch = deps.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM!.trim(),
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (e) {
    throw new MailDeliveryError(0, `mail provider unreachable: ${(e as Error).message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new MailDeliveryError(res.status, `mail provider responded ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json().catch(() => null)) as { id?: unknown } | null;
  return { transport: 'resend', id: typeof data?.id === 'string' ? data.id : null };
}
