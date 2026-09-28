import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logomark } from '@/components/ui/Logomark';
import s from './states.module.css';

/**
 * Frame for full-page states rendered outside the workspace layout (root
 * not-found / error / global-error): a slim bar with the logo home link,
 * content centered below. Inline use (inside a layout) skips the bar.
 */
export function StatePage({ fullPage, children }: { fullPage?: boolean; children: ReactNode }) {
  const body = <div className={s.errorBody}>{children}</div>;
  if (!fullPage) return body;
  return (
    <div className={s.page}>
      <header className={s.pageBar}>
        <Link href="/" className={`${s.brand} focus-ring`} aria-label="Codemare home">
          <Logomark />
          <span aria-hidden="true">codemare</span>
        </Link>
      </header>
      <main style={{ flex: 1, display: 'flex' }}>{body}</main>
    </div>
  );
}
