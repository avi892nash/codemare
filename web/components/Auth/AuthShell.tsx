import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { AuthValuePanel } from './AuthValuePanel';
import s from './Auth.module.css';

/**
 * The split auth screen: form column on the left, value panel (the topic hero
 * reel) on the right; below 900 px the panel becomes a short banner above the
 * form. Server component; the form and the reel are the only client parts.
 * The logo is the top bar's (it carries the wordmark on these screens), so the
 * form does not draw it a second time.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={`scroll ${s.shell}`}>
      <div className="auth-grid">
        <main className={s.formCol}>
          <div className={s.form}>{children}</div>
        </main>
        <AuthValuePanel />
      </div>
    </div>
  );
}

/** Page heading (the shared PageHeader: the page's h1 + one line of context). */
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
      <PageHeader title={title} subtitle={children} className={s.heading} />
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
