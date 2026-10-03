import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { ModuleCard } from '@/components/Learn/ModuleCard';
import { hours, LEVEL_LABEL, lessonsLabel, minutes, PageShell } from '@/components/Learn/parts';
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

/**
 * L2 — a track: the shared page header with the one primary action (start, continue, or view the completion), a line
 * of facts, how far along you are (once you are), then its modules as rows with the map's progress glyphs.
 */
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

  const facts = [
    LEVEL_LABEL[track.level],
    track.tier && track.tier.title !== track.title ? `${track.tier.title} tier` : null,
    `${track.modules.length} modules`,
    lessonsLabel(lessons),
    `${minutes(p.estMinutes)} of reading`,
    `about ${hours(track.estHours)} with practice`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageShell>
      <Breadcrumb items={[{ label: 'Learn', href: '/learn', icon: 'graduation' }, { label: track.title }]} />

      <div className={s.trackHead}>
        <PageHeader
          title={track.title}
          subtitle={track.summary}
          actions={
            cta && (
              <ButtonLink href={cta.href} variant="primary" size="lg" iconRight={cta.icon} className={s.headCta} data-testid="learn-primary-action">
                {cta.label}
              </ButtonLink>
            )
          }
        />
        <p className={s.facts}>{facts}</p>
        {(p.started || p.complete) && (
          <div className={s.progressLine}>
            <ProgressBar
              value={p.percent}
              tone={p.complete ? 'ok' : 'accent'}
              aria-label={`${track.title}: ${p.percent}% complete`}
              valueText={`${p.percent}%`}
            />
            <span>
              {p.lessonsDone} of {p.lessonsTotal} lessons · {p.checkpointsPassed} of {p.checkpointsTotal} checkpoints
            </span>
            {step && !p.complete && (
              <span>
                {p.resume ? 'Pick up: ' : 'Next: '}
                <strong>{step.kind === 'lesson' ? step.title : `${step.moduleTitle} checkpoint`}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      <div className={s.modules}>
        {track.modules.map((m, i) => (
          <ModuleCard key={m.slug} trackSlug={track.slug} mod={m} progress={p.modules[i]} index={i} />
        ))}
      </div>
    </PageShell>
  );
}
