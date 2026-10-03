import type { ReactNode } from 'react';
import s from './PageHeader.module.css';

/**
 * The header every page that scrolls starts with (the UX pass, decision 42):
 * a 26 px title, one line of context in secondary text, and optional actions
 * at the right. No uppercase eyebrow, no icon, no stat tiles — what a page
 * needs to say beyond that goes in its content. Renders the page's `h1`.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  titleId,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className={s.header}>
      <div className={s.text}>
        <h1 className={s.title} id={titleId}>
          {title}
        </h1>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
    </header>
  );
}
