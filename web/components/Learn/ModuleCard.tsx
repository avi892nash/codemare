import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import type { ModuleCore } from '@/lib/server/learnViews';
import type { CheckpointSummary, ModuleProgress } from '@/lib/server/rules/learnProgress';
import { minutes, StateIcon } from './parts';
import s from './learn.module.css';

export function CheckpointStatus({ summary }: { summary: CheckpointSummary }) {
  if (summary.passed && summary.best) {
    return (
      <Pill tone="ok" size="xs" icon="check">
        Passed · {summary.best.score}/{summary.best.total}
      </Pill>
    );
  }
  if (summary.best) {
    return (
      <Pill tone="warn" size="xs">
        Best {summary.best.score}/{summary.best.total} · retake
      </Pill>
    );
  }
  return (
    <Pill tone="muted" size="xs">
      {summary.questions} questions
    </Pill>
  );
}

function moduleStatus(p: ModuleProgress) {
  if (p.complete) return <Pill tone="ok" size="xs" icon="check">Complete</Pill>;
  const touched = p.lessons.some((l) => l.state !== 'not_started') || (p.checkpoint?.attempts ?? 0) > 0;
  return touched ? <Pill tone="accent" size="xs">In progress</Pill> : <Pill tone="muted" size="xs">Not started</Pill>;
}

/** L2 module block: lessons with completion state, then the checkpoint row. */
export function ModuleCard({ trackSlug, mod, progress, index }: { trackSlug: string; mod: ModuleCore; progress: ModuleProgress; index: number }) {
  const headingId = `module-${mod.slug}`;
  const cp = progress.checkpoint;
  return (
    <section className={`${s.card} ${s.module}`} aria-labelledby={headingId}>
      <div className={s.moduleHead}>
        <span className={`${s.moduleNum} mono`} data-done={progress.complete || undefined} aria-hidden="true">
          {progress.complete ? <Icon name="check" size={14} /> : index + 1}
        </span>
        <div>
          <h2 className={s.moduleTitle} id={headingId}>
            <span className="sr-only">Module {index + 1}: </span>
            {mod.title}
          </h2>
          <p className={s.moduleSummary}>{mod.summary}</p>
        </div>
        {moduleStatus(progress)}
      </div>
      <ol className={s.items}>
        {progress.lessons.map(({ lesson, state }) => (
          <li key={lesson.slug} className={s.item}>
            <Link href={`/learn/${trackSlug}/${lesson.slug}`}>
              <StateIcon state={state} />
              <span className={s.itemTitle}>{lesson.title}</span>
              <span className={s.itemMeta}>
                <Icon name="clock" size={12} />
                {minutes(lesson.estMinutes)}
              </span>
            </Link>
          </li>
        ))}
        {cp && (
          <li className={s.item} data-kind="checkpoint">
            <Link href={`/learn/${trackSlug}/${mod.slug}/checkpoint`}>
              <StateIcon state={cp.passed ? 'completed' : cp.attempts > 0 ? 'failed' : 'not_started'} />
              <span className={s.itemTitle}>
                <span className={s.cpLabel}>
                  <Icon name="target" size={13} />
                  Checkpoint
                </span>
              </span>
              <span className={s.itemMeta}>
                <CheckpointStatus summary={cp} />
              </span>
            </Link>
          </li>
        )}
      </ol>
    </section>
  );
}
