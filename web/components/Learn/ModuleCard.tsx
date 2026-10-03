import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import type { ModuleCore } from '@/lib/server/learnViews';
import type { CheckpointSummary, ModuleProgress } from '@/lib/server/rules/learnProgress';
import { minutes, StateIcon } from './parts';
import s from './learn.module.css';

/** A checkpoint's standing as quiet text (a passed one in green with a check; one to retake in amber). */
export function CheckpointStatus({ summary }: { summary: CheckpointSummary }) {
  if (summary.passed && summary.best) {
    return (
      <span className={s.status} data-tone="ok">
        <Icon name="check" size={12} />
        Passed · {summary.best.score}/{summary.best.total}
      </span>
    );
  }
  if (summary.best) {
    return (
      <span className={s.status} data-tone="warn">
        Best {summary.best.score}/{summary.best.total} · retake
      </span>
    );
  }
  return <span className={s.status}>{summary.questions} questions</span>;
}

/** Where a module stands: complete, how many lessons are done, or nothing at all while it is untouched. */
function ModuleState({ p }: { p: ModuleProgress }) {
  if (p.complete) {
    return (
      <span className={s.status} data-tone="ok">
        <Icon name="check" size={12} />
        Complete
      </span>
    );
  }
  const touched = p.lessons.some((l) => l.state !== 'not_started') || (p.checkpoint?.attempts ?? 0) > 0;
  if (!touched) return null;
  return <span className={s.status}>{p.lessonsDone === 0 ? 'In progress' : `${p.lessonsDone} of ${p.lessons.length} lessons`}</span>;
}

/** L2 module block: its lessons with the map's progress glyphs, then the checkpoint row. */
export function ModuleCard({ trackSlug, mod, progress, index }: { trackSlug: string; mod: ModuleCore; progress: ModuleProgress; index: number }) {
  const headingId = `module-${mod.slug}`;
  const cp = progress.checkpoint;
  return (
    <section className={s.module} aria-labelledby={headingId}>
      <header className={s.moduleHead}>
        <div className={s.moduleBar}>
          <div className={s.moduleHeading}>
            <span className={s.moduleNum} aria-hidden="true">
              Module {index + 1}
            </span>
            <h2 className={s.moduleTitle} id={headingId}>
              <span className="sr-only">Module {index + 1}: </span>
              {mod.title}
            </h2>
          </div>
          <ModuleState p={progress} />
        </div>
        <p className={s.moduleSummary}>{mod.summary}</p>
      </header>
      <ol className={s.items}>
        {progress.lessons.map(({ lesson, state }) => (
          <li key={lesson.slug} className={s.item}>
            <Link href={`/learn/${trackSlug}/${lesson.slug}`}>
              <StateIcon state={state} />
              <span className={s.itemTitle}>{lesson.title}</span>
              <span className={s.itemMeta}>{minutes(lesson.estMinutes)}</span>
            </Link>
          </li>
        ))}
        {cp && (
          <li className={s.item} data-kind="checkpoint">
            <Link href={`/learn/${trackSlug}/${mod.slug}/checkpoint`}>
              <StateIcon state={cp.passed ? 'completed' : cp.attempts > 0 ? 'failed' : 'not_started'} />
              <span className={s.itemTitle}>Checkpoint</span>
              <CheckpointStatus summary={cp} />
            </Link>
          </li>
        )}
      </ol>
    </section>
  );
}
