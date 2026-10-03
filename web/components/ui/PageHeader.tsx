import type { ReactNode } from 'react';
import s from './PageHeader.module.css';

/**
 * The header every page that scrolls starts with (the UX pass, decision 42):
 * a 26 px title, one line of context in secondary text, and optional actions
 * at the right. No uppercase eyebrow, no icon, no stat tiles — what a page
 * needs to say beyond that goes in its content. Renders the page's `h1`
 * (`as` is only for a demo of the header inside another page, e.g. the
 * design-system sheet).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  titleId,
  className,
  as: Heading = 'h1',
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  /** For a page that needs to style something inside its own header (the auth screens style an email in the subtitle). */
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'h4';
}) {
  return (
    <header className={[s.header, className].filter(Boolean).join(' ')}>
      <div className={s.text}>
        <Heading className={s.title} id={titleId}>
          {title}
        </Heading>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
    </header>
  );
}
