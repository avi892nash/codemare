import type { Metadata } from 'next';
import { AuthShell } from '@/components/Auth/AuthShell';
import { ResetForm, ResetLinkDead } from '@/components/Auth/ResetForm';
import { firstParam } from '@/components/Auth/messages';
import { RESET_TOKEN_TTL_MINUTES, checkResetToken } from '@/lib/server/passwordReset';

export const metadata: Metadata = {
  title: 'Choose a new password · Codemare',
  // The URL carries a live token: never send it on as a Referer.
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** /reset?token=… — the link from the reset email. Checked before the form renders. */
export default async function ResetPage({ searchParams }: { searchParams: SearchParams }) {
  const token = firstParam((await searchParams).token) ?? '';
  const state = await checkResetToken(token);
  return (
    <AuthShell>
      {state.ok ? (
        <ResetForm token={token} email={state.email} ttlMinutes={RESET_TOKEN_TTL_MINUTES} />
      ) : (
        <ResetLinkDead reason={state.reason} ttlMinutes={RESET_TOKEN_TTL_MINUTES} />
      )}
    </AuthShell>
  );
}
