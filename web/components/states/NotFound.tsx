import type { ReactNode } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { StatePage } from './StatePage';
import s from './states.module.css';

interface NotFoundProps {
  title?: string;
  description?: ReactNode;
  /** Primary way out. */
  homeHref?: string;
  homeLabel?: string;
  /** Adds the logo bar and fills the viewport (root not-found). */
  fullPage?: boolean;
  /** Inside a page that already has a <main> (see StatePage). */
  embedded?: boolean;
}

/**
 * 404. Used by app/not-found.tsx and by pages that call notFound() for a
 * missing handle / slug (then inline, inside the workspace layout).
 */
export function NotFound({
  title = 'Page not found',
  description = 'The page you asked for doesn’t exist, moved, or isn’t available to your account.',
  homeHref = '/problems',
  homeLabel = 'Go to problems',
  fullPage = false,
  embedded = false,
}: NotFoundProps) {
  // The page's h1 — or, embedded in the /dev/system sheet, a sub-heading.
  const Heading = embedded ? 'h4' : 'h1';
  return (
    <StatePage fullPage={fullPage} embedded={embedded}>
      <div className={s.errorCard}>
        <div className={s.code} aria-hidden="true">
          404<span>.</span>
        </div>
        <Heading className={s.title}>{title}</Heading>
        <p className={s.desc}>{description}</p>
        <div className={s.actions}>
          <ButtonLink href={homeHref} variant="primary" icon="list">
            {homeLabel}
          </ButtonLink>
          <ButtonLink href="/learn" variant="default" icon="graduation">
            Browse lessons
          </ButtonLink>
        </div>
      </div>
    </StatePage>
  );
}
