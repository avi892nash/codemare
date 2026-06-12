'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Button } from '../ui/Button';
import { Logomark } from '../ui/Logomark';
import { Pill } from '../ui/Pill';
import { AuthInput, FormField, authLinkStyle } from './FormField';

export type AuthMode = 'signin' | 'signup' | 'forgot';

interface AuthFormProps {
  mode: AuthMode;
  onModeChange: (m: AuthMode) => void;
}

const TITLE: Record<AuthMode, { h1: string; sub: string }> = {
  signin: { h1: 'Welcome back.',        sub: 'Pick up where you left off — your scratchpad is still warm.' },
  signup: { h1: 'Make an account.',     sub: 'Anonymous solving is fine. Save streaks, climb leaderboards, claim a handle.' },
  forgot: { h1: 'Forgot your password.', sub: "We'll send a one-time link. Expires in 15 minutes." },
};

const CTA: Record<AuthMode, string> = {
  signin: 'Sign in',
  signup: 'Create account',
  forgot: 'Send reset link',
};

export function AuthForm({ mode, onModeChange }: AuthFormProps) {
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const next = useSearchParams().get('next') || '/';
  const t = TITLE[mode];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'forgot') return; // password reset not wired yet
    if (!email.trim()) return;
    setBusy(true);
    // Dev login: email (+ name on signup). In production this path is the
    // real credentials/email flow; the 'dev' provider only exists outside prod.
    await signIn('dev', {
      email: email.trim(),
      name: mode === 'signup' ? handle.trim() : '',
      redirectTo: next,
    });
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 56, minHeight: 0 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 36 }}>
          <Logomark size={26} />
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.2 }}>codemare</span>
        </div>

        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.4 }}>{t.h1}</h1>
        <p style={{ margin: '6px 0 28px', fontSize: 13.5, color: 'var(--fg-2)' }}>{t.sub}</p>

        {mode !== 'forgot' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
              <Button
                variant="outline"
                full
                size="lg"
                icon="github"
                onClick={() => signIn('github', { redirectTo: '/' })}
              >
                Continue with GitHub
              </Button>
              <Button
                variant="outline"
                full
                size="lg"
                icon="google"
                onClick={() => signIn('google', { redirectTo: '/' })}
              >
                Continue with Google
              </Button>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: '18px 0',
                color: 'var(--fg-3)',
                fontSize: 11,
              }}
            >
              <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} /> or with email
              <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
            </div>
          </>
        )}

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'signup' && (
            <FormField
              label="Handle"
              hint="3–24 chars · letters, numbers, underscore"
              right={<Pill tone="ok" size="xs" icon="check">available</Pill>}
            >
              <AuthInput
                placeholder="mira_k"
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
          {mode !== 'forgot' && (
            <FormField
              label="Password"
              right={
                mode === 'signin' ? (
                  <a
                    style={authLinkStyle}
                    onClick={(e) => {
                      e.preventDefault();
                      onModeChange('forgot');
                    }}
                  >
                    Forgot?
                  </a>
                ) : null
              }
            >
              <AuthInput
                type="password"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
              />
            </FormField>
          )}
          <Button
            variant="primary"
            size="lg"
            full
            type="submit"
            iconRight="chev-right"
            disabled={busy}
            style={{ marginTop: 8 }}
          >
            {busy ? 'Signing in…' : CTA[mode]}
          </Button>
        </form>

        <div style={{ marginTop: 22, fontSize: 12.5, color: 'var(--fg-2)', textAlign: 'center' }}>
          {mode === 'signin' && (
            <>
              New here?{' '}
              <a style={authLinkStyle} onClick={() => onModeChange('signup')}>
                Make an account →
              </a>
            </>
          )}
          {mode === 'signup' && (
            <>
              Already in?{' '}
              <a style={authLinkStyle} onClick={() => onModeChange('signin')}>
                Sign in →
              </a>
            </>
          )}
          {mode === 'forgot' && (
            <>
              Remembered it?{' '}
              <a style={authLinkStyle} onClick={() => onModeChange('signin')}>
                Back to sign in →
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
