'use client';

import { useState } from 'react';
import { AuthForm, type AuthMode } from './AuthForm';
import { AuthValuePanel } from './AuthValuePanel';

/**
 * Full-page auth screen. Two columns on wide viewports — form on the left, a
 * value panel on the right; the panel collapses on narrow screens (see
 * .auth-grid / .auth-panel in globals.css), leaving a clean centered form.
 */
export function AuthPage() {
  const [mode, setMode] = useState<AuthMode>('signin');

  return (
    <div
      className="cm scroll"
      style={{
        height: '100%',
        overflowY: 'auto',
        background: 'var(--bg-0)',
        color: 'var(--fg-0)',
      }}
    >
      <div className="auth-grid">
        <div style={{ display: 'flex' }}>
          <div style={{ margin: 'auto', width: '100%' }}>
            <AuthForm mode={mode} onModeChange={setMode} />
          </div>
        </div>
        <AuthValuePanel />
      </div>
    </div>
  );
}
