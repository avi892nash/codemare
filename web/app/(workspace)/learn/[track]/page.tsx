import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ModuleCard } from '@/components/Learn/ModuleCard';
import { hours, LevelPill, minutes, PageShell } from '@/components/Learn/parts';
import s from '@/components/Learn/learn.module.css';
import { requireViewer } from '@/components/Learn/viewer';
import { getLearnTitles, getTrackView } from '@/lib/server/learnViews';
import { continueStep, stepHref } from '@/lib/server/rules/learnProgress';

type Params = { track: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { track } = await params;
  const titles = await getLearnTitles(track);
  return { title: titles ? `${titles.track} · Learn · Codemare` : 'Learn · Codemare' };
}

/** L2 — a track: modules, lessons with completion state, checkpoint status. */
export default async function TrackPage({ params }: { params: Promise<Params> }) {
  const { track: trackSlug } = await params;
  const viewer = await requireViewer(`/learn/${trackSlug}`);
  const view = await getTrackView(viewer.id, trackSlug);
  if (!view) notFound();
  const { track, progress: p } = view;
  const lessons = track.modules.reduce((n, m) => n + m.lessons.length, 0);

  const step = continueStep(p);
  const cta = p.complete
    ? { href: `/learn/${track.slug}/complete`, label: 'View your completion', icon: 'trophy' as const }
    : step
      ? { href: stepHref(track.slug, step), label: p.started ? 'Continue' : 'Start the first lesson', icon: 'arrow-right' as const }
      : null;

  return (
    <PageShell>
      <Breadcrumb items={[{ label: 'Learn', href: '/learn', icon: 'graduation' }, { label: track.title }]} />

      <div className={s.trackHeader}>
        <header className={s.header}>
          <div className={s.row}>
            <LevelPill level={track.level} size="sm" />
            {track.tier && track.tier.title !== track.title && (
              <Pill tone="muted" size="sm" icon="layers">
                {track.tier.title}
              </Pill>
            )}
          </div>
          <h1 className={s.title}>{track.title}</h1>
          <p className={s.subtitle}>{track.summary}</p>
          <div className={s.meta}>
            <span className={s.metaItem}>
              <Icon name="layers" size={13} />
              {track.modules.length} modules
            </span>
            <span className={s.metaItem}>
              <Icon name="book-open" size={13} />
              {lessons} lessons · {minutes(p.estMinutes)} of reading
            </span>
            <span className={s.metaItem}>
              <Icon name="clock" size={13} />
              about {hours(track.estHours)} with practice
            </span>
          </div>
        </header>

        <aside className={`${s.card} ${s.progressCard}`} aria-label="Your progress">
          <ProgressBar
            label="Your progress"
            value={p.percent}
            tone={p.complete ? 'ok' : 'accent'}
            showValue
            valueText={`${p.percent}%`}
            height={6}
          />
          <div className={s.meta} style={{ gap: '4px 12px' }}>
            <span className={s.metaItem}>
              <Icon name="check-circle" size={13} />
              {p.lessonsDone}/{p.lessonsTotal} lessons
            </span>
            <span className={s.metaItem}>
              <Icon name="target" size={13} />
              {p.checkpointsPassed}/{p.checkpointsTotal} checkpoints
            </span>
          </div>
          {step && !p.complete && (
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-2)' }}>
              {p.resume ? 'Pick up: ' : 'Next: '}
              <span style={{ color: 'var(--fg-0)' }}>{step.kind === 'lesson' ? step.title : `${step.moduleTitle} checkpoint`}</span>
            </p>
          )}
          {cta && (
            <ButtonLink href={cta.href} variant="primary" iconRight={cta.icon} full>
              {cta.label}
            </ButtonLink>
          )}
        </aside>
      </div>

      <div className={s.modules}>
        {track.modules.map((m, i) => (
          <ModuleCard key={m.slug} trackSlug={track.slug} mod={m} progress={p.modules[i]} index={i} />
        ))}
      </div>
    </PageShell>
  );
}
