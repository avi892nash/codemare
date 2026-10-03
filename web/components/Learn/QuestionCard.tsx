import Link from 'next/link';
import { DifficultyText } from '@/components/ui/DifficultyText';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import type { QuestionRef } from '@/lib/server/learnViews';
import s from './learn.module.css';

/** Where a question lives (spec §7). */
export const questionHref = (slug: string) => `/problems/${slug}`;

/**
 * A practice problem as one row (`:::question{slug=…}` and the lists of related problems): the map's glyph (solved or
 * not), the title and one quiet line, Easy · Medium · Hard as quiet text, and a chevron. A slug that is missing or
 * unpublished renders a muted, non-link row rather than a dead link. Pass `kicker={null}` where a heading already
 * says what the row is. Server-safe.
 */
export function QuestionCard({ slug, question, kicker = 'Practice' }: { slug: string; question?: QuestionRef; kicker?: string | null }) {
  if (!question) {
    return (
      <div className={s.linkRow} aria-disabled="true">
        <Icon name="lock" size={16} style={{ color: 'var(--fg-2)' }} />
        <span className={s.linkBody}>
          <span className={`${s.linkTitle} mono`}>{slug}</span>
          {kicker && <span className={s.linkMeta}>{kicker}</span>}
        </span>
        <span className={s.linkSide}>Not available yet</span>
      </div>
    );
  }
  const meta = [kicker, question.topic].filter(Boolean).join(' · ');
  return (
    <Link href={questionHref(question.slug)} className={`${s.linkRow} focus-ring`}>
      <span className={s.stateIcon}>
        <StatusDot status={question.solved ? 'solved' : 'unsolved'} />
        <span className="sr-only">{question.solved ? 'Solved. ' : 'Not solved. '}</span>
      </span>
      <span className={s.linkBody}>
        <span className={s.linkTitle}>{question.title}</span>
        {meta && <span className={s.linkMeta}>{meta}</span>}
      </span>
      <span className={s.linkSide}>
        <DifficultyText level={question.difficulty} />
        <Icon name="chev-right" size={16} />
      </span>
    </Link>
  );
}
