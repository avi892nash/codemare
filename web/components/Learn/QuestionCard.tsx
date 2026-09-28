import Link from 'next/link';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import type { QuestionRef } from '@/lib/server/learnViews';
import s from './learn.module.css';

/** Where a question lives (spec §7). */
export const questionHref = (slug: string) => `/problems/${slug}`;

/**
 * Link card to a practice question (`:::question{slug=…}` and the related
 * questions strip). A slug that is missing or unpublished renders a muted,
 * non-link card rather than a dead link. Server-safe.
 */
export function QuestionCard({ slug, question, kicker = 'Practice' }: { slug: string; question?: QuestionRef; kicker?: string }) {
  if (!question) {
    return (
      <div className={s.qcard} aria-disabled="true">
        <span className={s.qicon} aria-hidden="true">
          <Icon name="lock" size={15} />
        </span>
        <span className={s.qbody}>
          <span className={s.qkicker}>{kicker}</span>
          <span className={`${s.qtitle} mono`}>{slug}</span>
        </span>
        <span className={s.qside}>Not available yet</span>
      </div>
    );
  }
  return (
    <Link href={questionHref(question.slug)} className={`${s.qcard} focus-ring`}>
      <span className={s.qicon} aria-hidden="true">
        <Icon name="code" size={15} />
      </span>
      <span className={s.qbody}>
        <span className={s.qkicker}>
          {kicker}
          {question.topic ? ` · ${question.topic}` : ''}
        </span>
        <span className={s.qtitle}>{question.title}</span>
      </span>
      <span className={s.qside}>
        {question.solved && (
          <Pill tone="ok" size="xs" icon="check">
            Solved
          </Pill>
        )}
        <DifficultyPill level={question.difficulty} size="xs" />
        <Icon name="arrow-right" size={14} />
      </span>
    </Link>
  );
}
