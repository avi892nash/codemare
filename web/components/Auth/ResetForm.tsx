'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useMounted } from '@/components/ui/hooks';
import { signIn } from 'next-auth/react';
import { resetPassword } from '@/app/auth/actions';
import { Button, ButtonLink } from '@/components/ui/Button';
import { AuthHeading, FormAlert } from './AuthShell';
import { PasswordInput } from './PasswordInput';
import { DEFAULT_AFTER_SIGN_IN } from './routes';
import s from './Auth.module.css';

/** The link is unusable: invalid, already used, or past its 30 minutes. */
export function ResetLinkDead({ reason, ttlMinutes }: { reason: 'invalid' | 'expired'; ttlMinutes: number }) {
  return (
    <>
      <AuthHeading
        title={reason === 'expired' ? 'This link has expired.' : 'This link isn’t valid.'}
        icon={reason === 'expired' ? 'clock' : 'alert-circle'}
        tone="warn"
      >
        Reset links work once and expire {ttlMinutes} minutes after they are sent. Request a new one and use
        the most recent email.
      </AuthHeading>
      <div className={s.actions}>
        <ButtonLink href="/forgot" variant="primary" size="lg" full icon="send">
          Send a new link
        </ButtonLink>
      </div>
      <p className={s.alt}>
        <Link href="/signin" className={`${s.link} focus-ring`}>
          Back to sign in →
        </Link>
      </p>
    </>
  );
}

/** 07c (reset) · Choose a new password from a valid /reset?token= link. */
export function ResetForm({ token, email, ttlMinutes }: { token: string; email: string; ttlMinutes: number }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Until hydrated, a click would native-submit (GET) and silently drop the input.
  const mounted = useMounted();
  const [dead, setDead] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 8) {
      setErrors({ password: 'Password must be at least 8 characters' });
      return passwordRef.current?.focus();
    }
    if (confirm !== password) {
      setErrors({ confirm: 'The passwords don’t match' });
      return confirmRef.current?.focus();
    }
    setErrors({});
    setBusy(true);
    try {
      const res = await resetPassword({ token, password });
      if (!res.ok) {
        if (res.linkDead) setDead(true);
        else if (res.field === 'password') setErrors({ password: res.error });
        else setError(res.error ?? 'Could not reset your password.');
        setBusy(false);
        return;
      }
      const signedIn = await signIn('credentials', { email: res.email ?? email, password, redirect: false });
      window.location.assign(signedIn && !signedIn.error ? DEFAULT_AFTER_SIGN_IN : '/signin?reset=1');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  if (dead) return <ResetLinkDead reason="invalid" ttlMinutes={ttlMinutes} />;

  return (
    <>
      <AuthHeading title="Choose a new password.">
        For <strong>{email}</strong>. You&apos;ll be signed in as soon as it&apos;s saved.
      </AuthHeading>

      <form onSubmit={submit} noValidate className={s.fields} aria-label="Choose a new password">
        {error && <FormAlert>{error}</FormAlert>}
        {/* Lets password managers file the new password under the right account. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <PasswordInput
          ref={passwordRef}
          label="New password"
          size="lg"
          full
          autoComplete="new-password"
          aria-required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors({});
          }}
          error={errors.password}
          hint="At least 8 characters"
        />
        <PasswordInput
          ref={confirmRef}
          label="Confirm new password"
          size="lg"
          full
          autoComplete="new-password"
          aria-required
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            if (errors.confirm) setErrors({});
          }}
          error={errors.confirm}
        />
        <div className={s.actions}>
          <Button type="submit" variant="primary" size="lg" full iconRight="arrow-right" loading={busy} disabled={!mounted}>
            Save password and sign in
          </Button>
        </div>
      </form>
    </>
  );
}
