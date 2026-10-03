import Link from 'next/link';
import { Fragment } from 'react';
import { DifficultyText } from '@/components/ui/DifficultyText';
import { Icon } from '@/components/ui/Icon';
import { StatusDot } from '@/components/ui/StatusDot';
import type { TopicProblemView } from '@/lib/server/loopViews';
import { LinkPending } from './LinkPending';
import s from './map.module.css';

const PROGRESS_TEXT = { solved: 'Solved', attempted: 'Attempted', todo: 'Not started' } as const;

/**
 * One problem. The title links to the editor (the whole row is the target)
 * and its name is just the title; the status before it and the difficulty
 * after it are read alongside. A problem that a locked topic still keeps
 * closed — a composite question's other topic — is no link: it says which
 * topic it needs, linking to that topic's card.
 */
function ProblemRow({ problem: p }: { problem: TopicProblemView }) {
  if (p.needs.length > 0) {
    return (
      <li className={s.problem} data-locked="" data-slug={p.slug}>
        <span className={s.problemMark} aria-hidden="true">
          <Icon name="lock" size={14} />
        </span>
        <span className={s.problemName}>
          <span className="sr-only">Locked: </span>
          <span className={s.problemTitle}>{p.title}</span>
        </span>
        <DifficultyText level={p.difficulty} />
        <span className={s.problemNeeds}>
          Also needs{' '}
          {p.needs.map((t, i) => (
            <Fragment key={t.id}>
              {i > 0 && (i === p.needs.length - 1 ? ' and ' : ', ')}
              <a href={`#topic-${t.slug}`} className={`${s.inlineLink} focus-ring`}>
                {t.title}
              </a>
            </Fragment>
          ))}
        </span>
      </li>
    );
  }
  return (
    <li className={s.problem} data-progress={p.progress} data-slug={p.slug}>
      <span className="sr-only">{PROGRESS_TEXT[p.progress]}: </span>
      <Link href={`/problems/${p.slug}`} className={s.problemLink}>
        <span className={s.problemMark} aria-hidden="true">
          <LinkPending>
            <StatusDot status={p.progress === 'todo' ? 'unsolved' : p.progress} />
          </LinkPending>
        </span>
        <span className={s.problemTitle}>{p.title}</span>
      </Link>
      <DifficultyText level={p.difficulty} />
    </li>
  );
}

/** A list of problems (a topic's, or those outside every topic), labelled for assistive tech. */
export function ProblemList({ problems, label }: { problems: TopicProblemView[]; label: string }) {
  return (
    <ol className={s.problems} aria-label={label}>
      {problems.map((p) => (
        <ProblemRow key={p.slug} problem={p} />
      ))}
    </ol>
  );
}
