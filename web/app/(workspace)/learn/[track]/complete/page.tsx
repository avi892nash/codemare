import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeMedallion, RARITY } from '@/components/Badges/BadgeMedallion';
import bs from '@/components/Badges/badges.module.css';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CheckpointStatus } from '@/components/Learn/ModuleCard';
import { minutes, PageShell, SectionHead, StateIcon } from '@/components/Learn/parts';
import { QuestionCard } from '@/components/Learn/QuestionCard';
import { TrackCard } from '@/components/Learn/TrackCard';
import s from '@/components/Learn/learn.module.css';
import { requireViewer } from '@/components/Learn/viewer';
import { getLearnTitles, getTrackCompletion } from '@/lib/server/learnViews';
import { continueStep, learnSequence, stepHref } from '@/lib/server/rules/learnProgress';

type Params = { track: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { track } = await params;
  const titles = await getLearnTitles(track);
  return { title: titles ? `${titles.track} complete · Codemare` : 'Learn · Codemare' };
}

const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** L7 — track completion: summary, checkpoint scores, badges earned, what next. */
export default async function TrackCompletePage({ params }: { params: Promise<Params> }) {
  const { track: trackSlug } = await params;
  const viewer = await requireViewer(`/learn/${trackSlug}/complete`);
  const c = await getTrackCompletion(viewer.id, trackSlug);
  if (!c) notFound();
  const { track, progress: p } = c;

  const crumbs = (
    <Breadcrumb
      items={[
        { label: 'Learn', href: '/learn', icon: 'graduation' },
        { label: track.title, href: `/learn/${track.slug}` },
        { label: 'Completion' },
      ]}
    />
  );

  if (!p.complete) {
    const seq = learnSequence(track);
    const lessonState = new Map(p.modules.flatMap((m) => m.lessons.map((l) => [l.lesson.slug, l.state] as const)));
    const passed = new Map(track.modules.map((m, i) => [m.slug, p.modules[i].checkpoint?.passed ?? true] as const));
    const remaining = seq.filter((st) => (st.kind === 'lesson' ? lessonState.get(st.lessonSlug) !== 'completed' : !passed.get(st.moduleSlug)));
    const step = continueStep(p);
    return (
      <PageShell narrow>
        {crumbs}
        <header className={s.header}>
          <span className={s.eyebrow}>
            <Icon name="trophy" size={13} /> Track completion
          </span>
          <h1 className={s.title}>Almost there: {track.title}</h1>
          <p className={s.subtitle}>
            Finish every lesson and pass every module checkpoint to complete the track. {remaining.length} step
            {remaining.length === 1 ? '' : 's'} to go.
          </p>
        </header>
        <div className={`${s.card} ${s.progressCard}`}>
          <ProgressBar label="Track progress" value={p.percent} showValue valueText={`${p.percent}%`} height={6} />
          {step && (
            <div>
              <ButtonLink href={stepHref(track.slug, step)} variant="primary" iconRight="arrow-right">
                {step.kind === 'lesson' ? `Continue: ${step.title}` : `Take the ${step.moduleTitle} checkpoint`}
              </ButtonLink>
            </div>
          )}
        </div>
        <section aria-labelledby="remaining-title">
          <SectionHead title="Still to do" id="remaining-title" />
          <ul className={`${s.card} ${s.items}`}>
            {remaining.map((st) => (
              <li key={st.kind === 'lesson' ? st.lessonSlug : `${st.moduleSlug}-cp`} className={s.item} data-kind={st.kind === 'checkpoint' ? 'checkpoint' : undefined}>
                <Link href={stepHref(track.slug, st)}>
                  <StateIcon state={st.kind === 'lesson' ? (lessonState.get(st.lessonSlug) ?? 'not_started') : 'not_started'} />
                  <span className={s.itemTitle}>{st.kind === 'lesson' ? st.title : `Checkpoint: ${st.moduleTitle}`}</span>
                  <span className={s.itemMeta}>{st.kind === 'lesson' ? minutes(st.estMinutes) : `${st.questions} questions`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </PageShell>
    );
  }

  const scores = track.modules
    .map((m, i) => ({ mod: m, cp: p.modules[i].checkpoint }))
    .filter((x): x is { mod: (typeof track.modules)[number]; cp: NonNullable<typeof x.cp> } => x.cp !== null);
  const avg = scores.length
    ? Math.round((scores.reduce((n, x) => n + (x.cp.best ? x.cp.best.score / x.cp.best.total : 0), 0) / scores.length) * 100)
    : null;

  return (
    <PageShell narrow>
      {crumbs}
      <section className={s.celebrate} aria-labelledby="complete-title">
        <span className={s.medal} aria-hidden="true">
          <Icon name="trophy" size={30} />
        </span>
        <span className={s.eyebrow}>Track complete</span>
        <h1 className={s.celebrateTitle} id="complete-title">
          You finished {track.title}
        </h1>
        <p className={s.subtitle} style={{ textAlign: 'center' }}>
          Every lesson read and every checkpoint passed{p.completedAt ? ` — completed ${fmtDate(p.completedAt)}` : ''}.
        </p>
        <div className={s.row} style={{ justifyContent: 'center' }}>
          {viewer.handle && (
            <ButtonLink href={`/u/${viewer.handle}`} variant="default" size="sm" icon="user">
              Your profile
            </ButtonLink>
          )}
          <ButtonLink href={`/learn/${track.slug}`} variant="ghost" size="sm" icon="list">
            Review lessons
          </ButtonLink>
        </div>
      </section>

      <dl className={s.metrics} style={{ margin: 0 }}>
        <div className={`${s.card} ${s.metric}`} style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          <dt className={s.metricLabel}>Lessons completed</dt>
          <dd className={`${s.metricValue} mono`} style={{ margin: 0 }}>
            {p.lessonsDone}
          </dd>
        </div>
        <div className={`${s.card} ${s.metric}`} style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          <dt className={s.metricLabel}>Checkpoints passed</dt>
          <dd className={`${s.metricValue} mono`} style={{ margin: 0 }}>
            {p.checkpointsPassed}
          </dd>
        </div>
        <div className={`${s.card} ${s.metric}`} style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          <dt className={s.metricLabel}>Average best score</dt>
          <dd className={`${s.metricValue} mono`} style={{ margin: 0 }}>
            {avg === null ? '—' : `${avg}%`}
          </dd>
        </div>
        <div className={`${s.card} ${s.metric}`} style={{ display: 'flex', flexDirection: 'column-reverse' }}>
          <dt className={s.metricLabel}>Reading time</dt>
          <dd className={`${s.metricValue} mono`} style={{ margin: 0 }}>
            {minutes(p.estMinutes)}
          </dd>
        </div>
      </dl>

      {scores.length > 0 && (
        <section aria-labelledby="scores-title">
          <SectionHead title="Checkpoint scores" id="scores-title" />
          <ul className={`${s.card} ${s.scoreList}`}>
            {scores.map(({ mod, cp }) => (
              <li key={mod.slug}>
                <Link href={`/learn/${track.slug}/${mod.slug}/checkpoint`} className="focus-ring" style={{ color: 'var(--fg-0)', textDecoration: 'none', borderRadius: 4 }}>
                  {mod.title}
                </Link>
                <CheckpointStatus summary={cp} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="badges-title">
        <SectionHead title="Learning badges" id="badges-title" note={c.badges.length ? `${c.badges.length} earned` : undefined} />
        {c.badges.length === 0 ? (
          <p className={s.muted} style={{ margin: 0, fontSize: 13 }}>
            No learning badges yet — they unlock as you complete lessons and tracks.
          </p>
        ) : (
          <ul className={bs.grid}>
            {c.badges.map((b) => (
              <li key={b.slug}>
                <Link
                  href={viewer.handle ? `/u/${viewer.handle}/badges?badge=${b.slug}` : '/profile'}
                  className={`${bs.tile} focus-ring`}
                  style={{ textDecoration: 'none' }}
                  data-earned="true"
                >
                  <BadgeMedallion icon={b.icon} rarity={b.rarity} size={56} />
                  <span className={bs.tileName}>{b.name}</span>
                  <Pill tone={RARITY[b.rarity].tone} size="xs">
                    {RARITY[b.rarity].label}
                  </Pill>
                  <span className={bs.tileState}>
                    <span className={bs.tileDate}>
                      <Icon name="check-circle" size={12} />
                      Earned {b.awardedAt ? fmtDate(b.awardedAt) : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {c.practice.length > 0 && (
        <section aria-labelledby="practice-title">
          <SectionHead title="Put it into practice" id="practice-title" />
          <div className={s.qgrid}>
            {c.practice.map((q) => (
              <QuestionCard key={q.slug} slug={q.slug} question={q} kicker="Problem" />
            ))}
          </div>
        </section>
      )}

      {c.nextTrack && (
        <section aria-labelledby="next-title">
          <SectionHead title="Up next" id="next-title" />
          <TrackCard item={c.nextTrack} index={c.nextTrack.track.ord} />
        </section>
      )}
    </PageShell>
  );
}
