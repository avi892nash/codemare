import { useState } from 'react';
import { AuthForm, type AuthMode } from './AuthForm';
import { AuthBrandPanel } from './AuthBrandPanel';

/**
 * Full-page two-column auth screen. Form on the left, brand panel on the
 * right. The mode (signin / signup / forgot) is owned here so the inner links
 * can swap views without a route change.
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
      <div
        style={{
          minHeight: '100%',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
        }}
      >
        <AuthForm mode={mode} onModeChange={setMode} />
        <AuthBrandPanel />
      </div>
    </div>
  );
}
