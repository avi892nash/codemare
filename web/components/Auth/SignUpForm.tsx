'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { signUp, type AuthField } from '@/app/auth/actions';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HANDLE_INPUT_RE } from '@/lib/server/rules/handles';
import { AuthHeading, FormAlert } from './AuthShell';
import { OAuthButtons, type OAuthFlags } from './OAuthButtons';
import { PasswordInput } from './PasswordInput';
import s from './Auth.module.css';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type FieldErrors = Partial<Record<AuthField, string>>;

/** Client-side checks mirroring the server action (which re-validates). */
function validate(handle: string, email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!handle) errors.handle = 'Choose a username';
  else if (!HANDLE_INPUT_RE.test(handle)) errors.handle = 'Use 3–24 letters, numbers or underscores';
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters';
  return errors;
}

/** 07b · Create an account: username (→ handle), email, password. */
export function SignUpForm({ next, nextParam, providers }: { next: string; nextParam: string | null; providers: OAuthFlags }) {
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = {
    handle: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  const focusFirst = (errs: FieldErrors) => {
    const first = (['handle', 'email', 'password'] as const).find((f) => errs[f]);
    if (first) refs[first].current?.focus();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const trimmed = { handle: handle.trim(), email: email.trim() };
    const local = validate(trimmed.handle, trimmed.email, password);
    setErrors(local);
    if (Object.keys(local).length) return focusFirst(local);

    setBusy(true);
    try {
      const res = await signUp({ handle: trimmed.handle, email: trimmed.email, password });
      if (!res.ok) {
        if (res.field) {
          const errs = { [res.field]: res.error ?? 'Check this field' };
          setErrors(errs);
          focusFirst(errs);
        } else {
          setFormError(res.error ?? 'Could not create your account.');
        }
        setBusy(false);
        return;
      }
      const signedIn = await signIn('credentials', { email: trimmed.email, password, redirect: false });
      window.location.assign(signedIn && !signedIn.error ? next : '/signin');
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
      setBusy(false);
    }
  };

  const preview = HANDLE_INPUT_RE.test(handle.trim()) ? handle.trim().toLowerCase() : null;
  const signInLink = nextParam ? `/signin?next=${encodeURIComponent(nextParam)}` : '/signin';

  return (
    <>
      <AuthHeading title="Create your account.">
        Free to start. Solve problems, earn tokens and unlock new topics as you go.
      </AuthHeading>

      <OAuthButtons providers={providers} next={next} />

      <form onSubmit={submit} noValidate className={s.fields} aria-label="Create account">
        {formError && <FormAlert>{formError}</FormAlert>}

        <Input
          ref={refs.handle}
          label="Username"
          size="lg"
          full
          placeholder="ada_lovelace"
          autoComplete="nickname"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={24}
          aria-required
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            if (errors.handle) setErrors((x) => ({ ...x, handle: undefined }));
          }}
          error={errors.handle}
          hint={preview ? `Your public handle: @${preview}` : '3–24 letters, numbers or underscores. It becomes your public handle.'}
        />

        <Input
          ref={refs.email}
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
            if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
          }}
          error={errors.email}
        />

        <PasswordInput
          ref={refs.password}
          label="Password"
          size="lg"
          full
          placeholder="••••••••••"
          autoComplete="new-password"
          aria-required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
          }}
          error={errors.password}
          hint="At least 8 characters"
        />

        <div className={s.actions}>
          <Button type="submit" variant="primary" size="lg" full iconRight="arrow-right" loading={busy}>
            Create account
          </Button>
        </div>
      </form>

      <p className={s.alt}>
        Already have an account?{' '}
        <Link href={signInLink} className={`${s.link} focus-ring`}>
          Sign in →
        </Link>
      </p>
      <p className={s.legal}>
        By continuing you agree to run code in a sandboxed environment for practice and learning.
      </p>
    </>
  );
}
