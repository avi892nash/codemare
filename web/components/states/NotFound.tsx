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
}: NotFoundProps) {
  return (
    <StatePage fullPage={fullPage}>
      <div className={s.errorCard}>
        <div className={s.code} aria-hidden="true">
          404<span>.</span>
        </div>
        <h1 className={s.title}>{title}</h1>
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
