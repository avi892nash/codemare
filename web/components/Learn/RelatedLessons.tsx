import Link from 'next/link';
import { auth } from '@/auth';
import { Icon } from '@/components/ui/Icon';
import { getRelatedLessons } from '@/lib/server/learnViews';
import { minutes, StateIcon } from './parts';
import s from './learn.module.css';

export interface RelatedLessonsProps {
  /** The question's slug (`/problems/[slug]`). */
  questionSlug: string;
  /** The viewer, for completion ticks. Omit to read it from the session. */
  userId?: string | null;
  /** Max lessons shown (default 4). */
  limit?: number;
  /** Heading text (default "Learn the technique"). */
  title?: string;
}

/**
 * L8 "related lessons" strip for a problem page. Async server component:
 *
 *   <Suspense fallback={null}>
 *     <RelatedLessons questionSlug={slug} />
 *   </Suspense>
 *
 * Lessons that list the question in `related_question_slugs` come first;
 * without any, lessons on the question's main topic. Renders nothing when
 * there are none (or the question is unknown / a draft). Each lesson is the
 * same row as a practice problem on a lesson page: the map's glyph (done or
 * not), the title, one quiet line, a chevron.
 */
export async function RelatedLessons({ questionSlug, userId, limit = 4, title = 'Learn the technique' }: RelatedLessonsProps) {
  const viewer = userId === undefined ? ((await auth().catch(() => null))?.user?.id ?? null) : userId;
  const lessons = await getRelatedLessons(questionSlug, viewer, limit);
  if (lessons.length === 0) return null;
  const headingId = `related-lessons-${questionSlug}`;
  return (
    <section className={s.related} aria-labelledby={headingId}>
      <h2 className={s.relatedTitle} id={headingId}>
        {title}
      </h2>
      <ul className={s.linkGrid}>
        {lessons.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className={`${s.linkRow} focus-ring`}>
              <StateIcon state={l.completed ? 'completed' : 'not_started'} />
              <span className={s.linkBody}>
                <span className={s.linkTitle}>{l.title}</span>
                <span className={s.linkMeta}>
                  {l.trackTitle} · {l.moduleTitle} · {minutes(l.estMinutes)}
                </span>
              </span>
              <span className={s.linkSide}>
                <Icon name="chev-right" size={16} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
