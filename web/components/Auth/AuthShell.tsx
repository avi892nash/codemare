import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Logomark } from '@/components/ui/Logomark';
import { AuthValuePanel } from './AuthValuePanel';
import s from './Auth.module.css';

/**
 * The split auth screen: form column on the left, value panel on the right
 * (hidden below 900 px, leaving a centered form). Server component; the form
 * inside is the only client part.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={`scroll ${s.shell}`}>
      <div className="auth-grid">
        <main className={s.formCol}>
          <div className={s.form}>
            <div className={s.brand} aria-hidden="true">
              <Logomark size={26} />
              <span>codemare</span>
            </div>
            {children}
          </div>
        </main>
        <AuthValuePanel />
      </div>
    </div>
  );
}

/** Page heading + one line of context under it. */
export function AuthHeading({ title, children, icon, tone }: {
  title: string;
  children?: ReactNode;
  /** Optional icon tile above the title (confirmation / dead-link states). */
  icon?: IconName;
  tone?: 'accent' | 'warn';
}) {
  return (
    <>
      {icon && (
        <span className={s.mark} data-tone={tone} aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
      )}
      <h1 className={s.title}>{title}</h1>
      {children && <p className={s.sub}>{children}</p>}
    </>
  );
}

/**
 * Inline notice above a form. `err` is an alert (announced at once); `ok` and
 * `info` are polite status messages.
 */
export function FormAlert({ tone = 'err', children }: { tone?: 'err' | 'ok' | 'info'; children: ReactNode }) {
  const icon: IconName = tone === 'err' ? 'alert-circle' : tone === 'ok' ? 'check-circle' : 'info';
  return (
    <div className={s.alert} data-tone={tone} role={tone === 'err' ? 'alert' : 'status'}>
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </div>
  );
}
