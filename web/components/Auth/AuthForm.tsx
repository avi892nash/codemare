'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { signIn, getProviders } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '../ui/Button';
import { Logomark } from '../ui/Logomark';
import { Icon } from '../ui/Icon';
import { AuthInput, FormField, authLinkStyle } from './FormField';
import { signUp } from '@/app/auth/actions';

export type AuthMode = 'signin' | 'signup';

interface AuthFormProps {
  mode: AuthMode;
  onModeChange: (m: AuthMode) => void;
}

const COPY: Record<AuthMode, { h1: string; sub: string; cta: string }> = {
  signin: {
    h1: 'Welcome back.',
    sub: 'Sign in to keep solving and pick up where your last session left off.',
    cta: 'Sign in',
  },
  signup: {
    h1: 'Create your account.',
    sub: 'Free to start — solve problems, build your own sets, and track every run.',
    cta: 'Create account',
  },
};

export function AuthForm({ mode, onModeChange }: AuthFormProps) {
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauth, setOauth] = useState<{ github: boolean; google: boolean }>({
    github: false,
    google: false,
  });
  const next = useSearchParams().get('next') || '/';
  const c = COPY[mode];

  // Only surface OAuth buttons for providers the server actually has
  // configured — in dev with none set, the email form stands alone.
  useEffect(() => {
    getProviders()
      .then((p) => setOauth({ github: !!p?.github, google: !!p?.google }))
      .catch(() => undefined);
  }, []);
  const anyOauth = oauth.github || oauth.google;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      if (mode === 'signup') {
        const res = await signUp({ email: email.trim(), password, handle: handle.trim() || undefined });
        if (!res.ok) {
          setError(res.error ?? 'Could not create account');
          return;
        }
      }
      const result = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (result?.error) {
        setError('Invalid email or password');
        return;
      }
      window.location.href = next;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 40px', minHeight: 0 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          <Logomark size={26} />
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.2 }}>codemare</span>
        </div>

        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.4 }}>{c.h1}</h1>
        <p style={{ margin: '6px 0 28px', fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>{c.sub}</p>

        {anyOauth && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              {oauth.github && (
                <Button variant="outline" full size="lg" icon="github" onClick={() => signIn('github', { redirectTo: next })}>
                  Continue with GitHub
                </Button>
              )}
              {oauth.google && (
                <Button variant="outline" full size="lg" icon="google" onClick={() => signIn('google', { redirectTo: next })}>
                  Continue with Google
                </Button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 0', color: 'var(--fg-3)', fontSize: 11 }}>
              <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} /> or with email
              <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
            </div>
          </>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {error && (
            <div
              role="alert"
              style={{
                fontSize: 12.5,
                color: 'var(--err)',
                background: 'var(--err-bg)',
                border: '1px solid color-mix(in oklab, var(--err) 30%, transparent)',
                borderRadius: 'var(--r)',
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="alert-circle" size={14} />
              {error}
            </div>
          )}

          {mode === 'signup' && (
            <FormField label="Handle" hint="Optional · 3–24 chars: letters, numbers, underscore">
              <AuthInput
                placeholder="ada_lovelace"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                autoComplete="username"
                spellCheck={false}
              />
            </FormField>
          )}

          <FormField label="Email">
            <AuthInput
              type="email"
              placeholder="you@domain.dev"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </FormField>

          <FormField
            label="Password"
            hint={mode === 'signup' ? 'At least 8 characters' : undefined}
          >
            <div style={{ position: 'relative' }}>
              <AuthInput
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                style={{ paddingRight: 38 }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: 6,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--fg-3)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  padding: 4,
                }}
              >
                <Icon name={showPw ? 'eye-off' : 'eye'} size={15} />
              </button>
            </div>
          </FormField>

          <Button
            variant="primary"
            size="lg"
            full
            type="submit"
            iconRight="arrow-right"
            disabled={busy}
            style={{ marginTop: 6 }}
          >
            {busy ? 'One moment…' : c.cta}
          </Button>
        </form>

        <div style={{ marginTop: 22, fontSize: 12.5, color: 'var(--fg-2)', textAlign: 'center' }}>
          {mode === 'signin' ? (
            <>
              New to Codemare?{' '}
              <a style={authLinkStyle} onClick={() => { setError(null); onModeChange('signup'); }}>
                Create an account →
              </a>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <a style={authLinkStyle} onClick={() => { setError(null); onModeChange('signin'); }}>
                Sign in →
              </a>
            </>
          )}
        </div>

        <p style={{ marginTop: 28, fontSize: 11, color: 'var(--fg-4)', textAlign: 'center', lineHeight: 1.5 }}>
          By continuing you agree to run code in a sandboxed environment for
          practice and learning.
        </p>
      </div>
    </div>
  );
}
