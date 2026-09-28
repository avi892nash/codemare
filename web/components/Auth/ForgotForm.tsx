'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { requestPasswordReset } from '@/app/auth/actions';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthHeading, FormAlert } from './AuthShell';
import s from './Auth.module.css';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * 07c · Forgot password. The confirmation is the same whether or not the
 * email has an account (the server decides silently what to send).
 */
export function ForgotForm({ ttlMinutes, consoleTransport }: {
  ttlMinutes: number;
  /** Dev only: no mail transport, so the link goes to the server console. */
  consoleTransport: boolean;
}) {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);

  // Move focus to the confirmation so screen readers land on it.
  useEffect(() => {
    if (sentTo) headingRef.current?.focus();
  }, [sentTo]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setFieldError('Enter a valid email');
      emailRef.current?.focus();
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      const res = await requestPasswordReset({ email: value });
      if (!res.ok) {
        if (res.field === 'email') setFieldError(res.error ?? 'Enter a valid email');
        else setError(res.error ?? 'Could not send the link. Try again.');
        return;
      }
      setSentTo(value);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <div ref={headingRef} tabIndex={-1} style={{ outline: 'none' }} aria-live="polite">
        <AuthHeading title="Check your inbox." icon="send">
          If an account exists for <strong>{sentTo}</strong>, we&apos;ve sent it a link to choose a new
          password. The link expires in {ttlMinutes} minutes.
        </AuthHeading>
        {consoleTransport && (
          <FormAlert tone="info">
            Development: no mail transport is configured, so the link is printed in the server console instead.
          </FormAlert>
        )}
        <div className={s.actions} style={{ marginTop: 18 }}>
          <ButtonLink href="/signin" variant="primary" size="lg" full icon="arrow-right">
            Back to sign in
          </ButtonLink>
          <Button
            variant="ghost"
            size="lg"
            full
            onClick={() => {
              setSentTo(null);
              setTimeout(() => emailRef.current?.focus(), 0);
            }}
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <AuthHeading title="Reset your password.">
        Enter your account&apos;s email and we&apos;ll send you a link to choose a new password.
      </AuthHeading>

      <form onSubmit={submit} noValidate className={s.fields} aria-label="Reset password">
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          ref={emailRef}
          label="Email"
          type="email"
          size="lg"
          full
          placeholder="you@domain.dev"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          aria-required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (fieldError) setFieldError(null);
          }}
          error={fieldError ?? undefined}
        />
        <div className={s.actions}>
          <Button type="submit" variant="primary" size="lg" full icon="send" loading={busy}>
            Send reset link
          </Button>
        </div>
      </form>

      <p className={s.alt}>
        Remembered it?{' '}
        <Link href="/signin" className={`${s.link} focus-ring`}>
          Back to sign in →
        </Link>
      </p>
    </>
  );
}
