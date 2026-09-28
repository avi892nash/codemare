import type { Metadata } from 'next';
import { AuthShell } from '@/components/Auth/AuthShell';
import { ForgotForm } from '@/components/Auth/ForgotForm';
import { mailTransport } from '@/lib/mailer';
import { RESET_TOKEN_TTL_MINUTES } from '@/lib/server/passwordReset';

export const metadata: Metadata = { title: 'Reset password · Codemare' };

/** 07c · /forgot: request a reset link by email. */
export default function ForgotPage() {
  const consoleTransport = process.env.NODE_ENV !== 'production' && mailTransport() === 'console';
  return (
    <AuthShell>
      <ForgotForm ttlMinutes={RESET_TOKEN_TTL_MINUTES} consoleTransport={consoleTransport} />
    </AuthShell>
  );
}
