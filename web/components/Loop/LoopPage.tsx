import type { ReactNode } from 'react';
import s from './loop.module.css';

/** Scrollable page + centered column inside the workspace layout. */
export function LoopPage({ children, narrow = false, label }: { children: ReactNode; narrow?: boolean; label?: string }) {
  return (
    <main className={`${s.page} scroll`} aria-label={label}>
      <div className={[s.container, narrow && s.narrow].filter(Boolean).join(' ')}>{children}</div>
    </main>
  );
}
