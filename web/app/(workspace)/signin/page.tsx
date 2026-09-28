import type { Metadata } from 'next';
import { oauthProviders } from '@/auth';
import { AuthShell } from '@/components/Auth/AuthShell';
import { SignInForm } from '@/components/Auth/SignInForm';
import { authErrorMessage, firstParam } from '@/components/Auth/messages';
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from '@/components/Auth/routes';

export const metadata: Metadata = { title: 'Sign in · Codemare' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 07a · /signin[?next=/path][&error=<Auth.js code>][&reset=1]. Signed-in visitors never get here (middleware). */
export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const nextParam = safeNextPath(firstParam(sp.next));
  return (
    <AuthShell>
      <SignInForm
        next={nextParam ?? DEFAULT_AFTER_SIGN_IN}
        nextParam={nextParam}
        providers={oauthProviders}
        initialError={authErrorMessage(firstParam(sp.error))}
        notice={firstParam(sp.reset) === '1' ? 'Password updated. Sign in with your new password.' : null}
      />
    </AuthShell>
  );
}
