import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Icon, type IconName } from './Icon';
import s from './Breadcrumb.module.css';

export interface Crumb {
  label: string;
  /** Omit on the last crumb (the current page). */
  href?: string;
  icon?: IconName;
}

/**
 * Path trail: <nav aria-label="Breadcrumb"> + ordered list, the last crumb
 * marked aria-current="page". Long labels truncate with an ellipsis (the
 * full text stays in the title attribute). Server-safe.
 */
export function Breadcrumb({ items, className, style }: { items: Crumb[]; className?: string; style?: CSSProperties }) {
  return (
    <nav aria-label="Breadcrumb" className={className} style={style}>
      <ol className={s.list}>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          const inner = (
            <>
              {c.icon && <Icon name={c.icon} size={13} />}
              {c.label}
            </>
          );
          return (
            <li key={`${c.label}-${i}`} className={s.item}>
              {c.href && !last ? (
                <Link href={c.href} className={`${s.link} focus-ring`} title={c.label}>{inner}</Link>
              ) : (
                <span className={s.current} aria-current={last ? 'page' : undefined} title={c.label}>{inner}</span>
              )}
              {!last && <Icon name="chev-right" size={12} className={s.sep} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
