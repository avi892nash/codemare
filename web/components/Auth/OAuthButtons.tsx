'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import s from './Auth.module.css';

export interface OAuthFlags {
  github: boolean;
  google: boolean;
}

/**
 * "Continue with GitHub / Google" for the providers configured on the server
 * (auth.ts `oauthProviders`), then an "or with email" divider. Renders
 * nothing when none is configured.
 */
export function OAuthButtons({ providers, next }: { providers: OAuthFlags; next: string }) {
  const [busy, setBusy] = useState<'github' | 'google' | null>(null);
  if (!providers.github && !providers.google) return null;

  const go = (id: 'github' | 'google') => {
    setBusy(id);
    void signIn(id, { redirectTo: next }).catch(() => setBusy(null));
  };

  return (
    <>
      <div className={s.oauth}>
        {providers.github && (
          <Button variant="outline" size="lg" full icon="github" loading={busy === 'github'} disabled={busy !== null && busy !== 'github'} onClick={() => go('github')}>
            Continue with GitHub
          </Button>
        )}
        {providers.google && (
          <Button variant="outline" size="lg" full icon="google" loading={busy === 'google'} disabled={busy !== null && busy !== 'google'} onClick={() => go('google')}>
            Continue with Google
          </Button>
        )}
      </div>
      <div className={s.divider}>or with email</div>
    </>
  );
}
