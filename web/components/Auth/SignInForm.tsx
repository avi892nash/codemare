'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { useMounted } from '@/components/ui/hooks';
import { signIn } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AuthHeading, FormAlert } from './AuthShell';
import { OAuthButtons, type OAuthFlags } from './OAuthButtons';
import { PasswordInput } from './PasswordInput';
import { credentialsErrorMessage } from './messages';
import s from './Auth.module.css';

export interface SignInFormProps {
  /** Where to go once signed in (already validated by the page). */
  next: string;
  /** The raw `next` to carry over to /signup, when there was one. */
  nextParam: string | null;
  providers: OAuthFlags;
  /** From an Auth.js ?error= redirect. */
  initialError?: string | null;
  /** Confirmation to show above the form (e.g. after a password reset). */
  notice?: string | null;
}

/** 07a · Sign in with email + password (and GitHub when configured). */
export function SignInForm({ next, nextParam, providers, initialError = null, notice = null }: SignInFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  // Until hydrated, a click would native-submit (GET) and silently drop the input.
  const mounted = useMounted();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!email.trim()) return emailRef.current?.focus();
    if (!password) return passwordRef.current?.focus();
    setBusy(true);
    try {
      const result = await signIn('credentials', { email: email.trim(), password, redirect: false });
      if (!result || result.error) {
        setError(credentialsErrorMessage(result?.code));
        setBusy(false);
        passwordRef.current?.select();
        return;
      }
      // A full navigation so the server layout renders with the new session.
      window.location.assign(next);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  const signUpHref = nextParam ? `/signup?next=${encodeURIComponent(nextParam)}` : '/signup';

  return (
    <>
      <AuthHeading title="Welcome back.">
        Sign in to keep solving and pick up where your last session left off.
      </AuthHeading>

      <OAuthButtons providers={providers} next={next} />

      <form onSubmit={submit} noValidate className={s.fields} aria-label="Sign in">
        {notice && !error && <FormAlert tone="ok">{notice}</FormAlert>}
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
          onChange={(e) => setEmail(e.target.value)}
        />

        <div className={s.withCorner}>
          <PasswordInput
            ref={passwordRef}
            label="Password"
            size="lg"
            full
            placeholder="••••••••••"
            autoComplete="current-password"
            aria-required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Link href="/forgot" className={`${s.link} ${s.corner} focus-ring`}>
            Forgot password?
          </Link>
        </div>

        <div className={s.actions}>
          <Button type="submit" variant="primary" size="lg" full iconRight="arrow-right" loading={busy} disabled={!mounted}>
            Sign in
          </Button>
        </div>
      </form>

      <p className={s.alt}>
        New to Codemare?{' '}
        <Link href={signUpHref} className={`${s.link} focus-ring`}>
          Create an account →
        </Link>
      </p>
      <p className={s.legal}>
        By continuing you agree to run code in a sandboxed environment for practice and learning.
      </p>
    </>
  );
}
