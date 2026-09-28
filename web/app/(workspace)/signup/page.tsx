import type { Metadata } from 'next';
import { oauthProviders } from '@/auth';
import { AuthShell } from '@/components/Auth/AuthShell';
import { SignUpForm } from '@/components/Auth/SignUpForm';
import { firstParam } from '@/components/Auth/messages';
import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from '@/components/Auth/routes';

export const metadata: Metadata = { title: 'Create account · Codemare' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 07b · /signup[?next=/path]. */
export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const nextParam = safeNextPath(firstParam((await searchParams).next));
  return (
    <AuthShell>
      <SignUpForm next={nextParam ?? DEFAULT_AFTER_SIGN_IN} nextParam={nextParam} providers={oauthProviders} />
    </AuthShell>
  );
}
