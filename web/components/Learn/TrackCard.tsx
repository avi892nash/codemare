import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { LearnRecommendation, TrackWithProgress } from '@/lib/server/learnViews';
import { stepHref } from '@/lib/server/rules/learnProgress';
import { LEVEL_LABEL, lessonsLabel, minutes } from './parts';
import s from './learn.module.css';

/** "2 of 7 lessons · 1 of 3 checkpoints". */
export function progressText(p: TrackWithProgress['progress']): string {
  return `${p.lessonsDone} of ${p.lessonsTotal} lessons · ${p.checkpointsPassed} of ${p.checkpointsTotal} checkpoints`;
}

/**
 * A track as one row of the list: its title (the link, whole row), one line about it, the facts, and — once started —
 * how far along the learner is. A track that has not been started shows no empty bar and no zeros.
 */
function TrackRow({ item }: { item: TrackWithProgress }) {
  const { track, progress: p } = item;
  const lessons = track.modules.reduce((n, m) => n + m.lessons.length, 0);
  const headingId = `track-${track.slug}`;
  const facts = [LEVEL_LABEL[track.level], lessonsLabel(lessons), minutes(p.estMinutes)].join(' · ');
  return (
    <article className={s.trackRow} aria-labelledby={headingId} data-complete={p.complete || undefined}>
      <div className={s.trackMain}>
        <h3 className={s.trackTitle} id={headingId}>
          <Link href={`/learn/${track.slug}`} className="focus-ring">
            {track.title}
          </Link>
        </h3>
        <p className={s.trackSummary}>{track.summary}</p>
        <p className={s.facts}>{facts}</p>
      </div>
      {(p.started || p.complete) && (
        <div className={s.trackProgress}>
          <ProgressBar
            value={p.percent}
            max={100}
            tone={p.complete ? 'ok' : 'accent'}
            aria-label={`${track.title}: ${progressText(p)}`}
            valueText={`${p.percent}%`}
          />
          <span className={s.trackCount}>{p.complete ? 'Complete' : progressText(p)}</span>
        </div>
      )}
      <Icon name="chev-right" size={16} className={s.chev} />
    </article>
  );
}

/** The tracks, one container with a row each. */
export function TrackList({ items, label = 'Tracks' }: { items: readonly TrackWithProgress[]; label?: string }) {
  return (
    <ul className={s.tracks} aria-label={label}>
      {items.map((item) => (
        <li key={item.track.slug}>
          <TrackRow item={item} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The one thing Learn home asks you to do: start the first track, or pick up where you left off. A calm card and a
 * single primary button; the tracks below it are links, not more buttons.
 */
export function Recommendation({ rec, firstVisit }: { rec: LearnRecommendation; firstVisit: boolean }) {
  const { track, step, started } = rec;
  const kicker = started ? 'Continue where you left off' : firstVisit ? 'Start here' : 'Up next';
  const size = step.kind === 'lesson' ? minutes(step.estMinutes) : `${step.questions} questions`;
  // Started: where in the track the next step is. Not started: what the first step is.
  const line = started ? `${step.moduleTitle} · ${size}` : `${step.kind === 'lesson' ? 'First lesson' : 'First step'}: ${step.title} · ${size}`;
  return (
    <section className={s.feature} aria-labelledby="up-next-title" data-testid="learn-recommendation">
      <p className={s.kicker}>{kicker}</p>
      <h2 className={s.featureTitle} id="up-next-title">
        {track.track.title}
      </h2>
      <p className={s.featureLine}>{line}</p>
      <ButtonLink
        href={stepHref(track.track.slug, step)}
        variant="primary"
        size="lg"
        iconRight="arrow-right"
        className={s.featureCta}
        data-testid="learn-primary-action"
      >
        {started ? `Continue: ${step.title}` : `Start ${track.track.title}`}
      </ButtonLink>
    </section>
  );
}
