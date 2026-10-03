import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { ModuleCore, TrackCore } from '@/lib/server/learnViews';
import { stepHref, type LearnStep, type ModuleProgress, type TrackProgress } from '@/lib/server/rules/learnProgress';
import { StateIcon } from './parts';
import s from './learn.module.css';

/**
 * Sidebar for lesson and checkpoint pages: the current module's lessons
 * (current one marked aria-current) and its checkpoint, plus track progress.
 */
export function LessonOutline({
  track,
  mod,
  moduleIndex,
  moduleProgress,
  trackProgress,
  current,
}: {
  track: TrackCore;
  mod: ModuleCore;
  moduleIndex: number;
  moduleProgress: ModuleProgress;
  trackProgress: TrackProgress;
  current: { kind: 'lesson'; slug: string } | { kind: 'checkpoint' };
}) {
  const cp = moduleProgress.checkpoint;
  return (
    <nav className={`${s.card} ${s.outline}`} aria-label={`Module ${moduleIndex + 1}: ${mod.title}`}>
      <div className={s.outlineHead}>
        <span className={s.outlineKicker}>
          Module {moduleIndex + 1} of {track.modules.length}
        </span>
        <span className={s.outlineTitle}>{mod.title}</span>
      </div>
      <ol className={s.outlineList}>
        {moduleProgress.lessons.map(({ lesson, state }) => (
          <li key={lesson.slug}>
            <Link
              href={`/learn/${track.slug}/${lesson.slug}`}
              aria-current={current.kind === 'lesson' && current.slug === lesson.slug ? 'page' : undefined}
            >
              <StateIcon state={state} />
              <span>{lesson.title}</span>
            </Link>
          </li>
        ))}
        {cp && (
          <li>
            <Link href={`/learn/${track.slug}/${mod.slug}/checkpoint`} aria-current={current.kind === 'checkpoint' ? 'page' : undefined}>
              <StateIcon state={cp.passed ? 'completed' : cp.attempts > 0 ? 'failed' : 'not_started'} />
              <span>
                Checkpoint <span className={s.muted}>· {cp.questions} questions</span>
              </span>
            </Link>
          </li>
        )}
      </ol>
      <div className={s.outlineFoot}>
        <div className={s.outlineProgress}>
          <span>{track.title}</span>
          <span>{trackProgress.percent}%</span>
        </div>
        <ProgressBar
          value={trackProgress.percent}
          tone={trackProgress.complete ? 'ok' : 'accent'}
          aria-label={`${track.title}: ${trackProgress.percent}% complete`}
          valueText={`${trackProgress.percent}%`}
        />
        <Link href={`/learn/${track.slug}`} className={`${s.outlineLink} focus-ring`}>
          All modules
          <Icon name="arrow-right" size={12} />
        </Link>
      </div>
    </nav>
  );
}

function stepLabel(step: LearnStep) {
  return step.kind === 'lesson' ? step.title : `Checkpoint: ${step.moduleTitle}`;
}

/** Previous / next step in learning order. */
export function Pager({ trackSlug, prev, next }: { trackSlug: string; prev: LearnStep | null; next: LearnStep | null }) {
  if (!prev && !next) return null;
  return (
    <nav className={s.pager} aria-label="Lesson navigation">
      {prev && (
        <Link href={stepHref(trackSlug, prev)} className={`${s.pagerLink} focus-ring`} data-dir="prev" rel="prev">
          <span className={s.pagerDir}>
            <Icon name="chev-left" size={12} /> Previous
          </span>
          <span className={s.pagerTitle}>{stepLabel(prev)}</span>
        </Link>
      )}
      {next && (
        <Link href={stepHref(trackSlug, next)} className={`${s.pagerLink} focus-ring`} data-dir="next" rel="next">
          <span className={s.pagerDir}>
            Next <Icon name="chev-right" size={12} />
          </span>
          <span className={s.pagerTitle}>{stepLabel(next)}</span>
        </Link>
      )}
    </nav>
  );
}
