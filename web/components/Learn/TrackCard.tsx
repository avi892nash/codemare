import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { TrackWithProgress } from '@/lib/server/learnViews';
import { continueStep, stepHref, type LearnStep } from '@/lib/server/rules/learnProgress';
import { hours, LevelPill, minutes, TRACK_ICONS } from './parts';
import s from './learn.module.css';

function progressText(p: TrackWithProgress['progress']) {
  return `${p.lessonsDone} of ${p.lessonsTotal} lessons · ${p.checkpointsPassed} of ${p.checkpointsTotal} checkpoints`;
}

/** L3 track tile: level, summary, modules, progress and the one next action. */
export function TrackCard({ item, index }: { item: TrackWithProgress; index: number }) {
  const { track, progress: p } = item;
  const lessons = track.modules.reduce((n, m) => n + m.lessons.length, 0);
  const headingId = `track-${track.slug}`;
  const step = continueStep(p);
  const cta = p.complete
    ? { href: `/learn/${track.slug}/complete`, label: 'Review', icon: 'trophy' as const, variant: 'default' as const }
    : step
      ? { href: stepHref(track.slug, step), label: p.started ? 'Continue' : 'Start track', icon: 'arrow-right' as const, variant: p.started ? ('primary' as const) : ('default' as const) }
      : null;
  return (
    <article className={s.trackCard} aria-labelledby={headingId}>
      <div className={s.trackTop}>
        <span className={s.trackIcon} aria-hidden="true">
          <Icon name={TRACK_ICONS[index % TRACK_ICONS.length]} size={16} />
        </span>
        <LevelPill level={track.level} />
        {track.tier && track.tier.title !== track.title && (
          <Pill tone="muted" size="xs">
            {track.tier.title}
          </Pill>
        )}
        <span className={s.spacer} />
        {p.complete && (
          <Pill tone="ok" size="xs" icon="check">
            Complete
          </Pill>
        )}
      </div>
      <h3 className={s.trackTitle} id={headingId}>
        <Link href={`/learn/${track.slug}`} className="focus-ring">
          {track.title}
        </Link>
      </h3>
      <p className={s.trackSummary}>{track.summary}</p>
      <div className={s.moduleChips} aria-label="Modules">
        {track.modules.map((m) => (
          <Pill key={m.slug} tone="default" size="xs">
            {m.title}
          </Pill>
        ))}
      </div>
      <div className={s.meta}>
        <span className={s.metaItem}>
          <Icon name="layers" size={13} />
          {track.modules.length} modules
        </span>
        <span className={s.metaItem}>
          <Icon name="book-open" size={13} />
          {lessons} lessons
        </span>
        <span className={s.metaItem}>
          <Icon name="clock" size={13} />
          {hours(track.estHours)}
        </span>
      </div>
      <ProgressBar
        value={p.percent}
        max={100}
        tone={p.complete ? 'ok' : 'accent'}
        showValue
        valueText={`${p.percent}%`}
        aria-label={`${track.title}: ${progressText(p)}`}
        style={{ marginTop: 2 }}
      />
      <div className={s.trackFoot}>
        <span className={s.muted} style={{ fontSize: 12 }}>
          {progressText(p)}
        </span>
        <span className={s.spacer} />
        {cta && (
          <ButtonLink href={cta.href} size="sm" variant={cta.variant} iconRight={cta.icon} aria-label={`${cta.label}: ${track.title}`}>
            {cta.label}
          </ButtonLink>
        )}
      </div>
    </article>
  );
}

/** "Continue where you left off" banner — or "Up next" when it suggests a track not started yet. */
export function ContinueCard({ track, step }: { track: TrackWithProgress; step: LearnStep }) {
  const isLesson = step.kind === 'lesson';
  const fresh = !track.progress.started;
  return (
    <section className={s.continue} aria-labelledby="continue-title">
      <span className={s.continueIcon} aria-hidden="true">
        <Icon name={isLesson ? 'book-open' : 'target'} size={20} />
      </span>
      <div className={s.continueBody}>
        <span className={s.eyebrow}>{fresh ? `Up next · ${track.track.title}` : 'Continue where you left off'}</span>
        <h2 className={s.continueTitle} id="continue-title">
          {step.title}
        </h2>
        <div className={s.meta}>
          <span className={s.metaItem}>
            {track.track.title} · {step.moduleTitle}
          </span>
          <span className={s.metaItem}>
            <Icon name={isLesson ? 'clock' : 'list'} size={13} />
            {isLesson ? minutes(step.estMinutes) : `${step.questions} questions`}
          </span>
          <span className={s.metaItem}>
            <Icon name="trend" size={13} />
            {track.progress.percent}% of the track done
          </span>
        </div>
      </div>
      <ButtonLink href={stepHref(track.track.slug, step)} variant="primary" iconRight="arrow-right">
        {isLesson ? (fresh ? 'Start lesson' : 'Resume lesson') : 'Take the checkpoint'}
      </ButtonLink>
    </section>
  );
}
