import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logomark } from '@/components/ui/Logomark';
import s from './states.module.css';

export interface StatePageProps {
  /** Adds the logo bar and fills the viewport (root not-found / error / global-error). */
  fullPage?: boolean;
  /**
   * Rendered inside something that already has its own <main> (the
   * /dev/system sheet): no landmark, just the centered body.
   */
  embedded?: boolean;
  children: ReactNode;
}

/**
 * Frame for the shared 404 / 500 states. Full page (outside the workspace
 * layout): a slim bar with the logo home link, content centered below.
 * Inline (a not-found / error boundary inside the workspace layout): the
 * page's <main> landmark, scrollable, content centered — so a boundary
 * never leaves the page without a main region.
 */
export function StatePage({ fullPage, embedded, children }: StatePageProps) {
  const body = <div className={s.errorBody}>{children}</div>;
  if (embedded) return body;
  if (!fullPage) return <main className={`${s.inlineMain} scroll`}>{body}</main>;
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
