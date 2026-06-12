'use client';

import { useState } from 'react';
import { AuthForm, type AuthMode } from './AuthForm';

/**
 * Full-page auth screen — a single centered column. The mode
 * (signin / signup / forgot) is owned here so the inner links can swap views
 * without a route change.
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
        display: 'flex',
        justifyContent: 'center',
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <AuthForm mode={mode} onModeChange={setMode} />
      </div>
    </div>
  );
}
