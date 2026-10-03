import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeMedallion, RARITY } from '@/components/Badges/BadgeMedallion';
import bs from '@/components/Badges/badges.module.css';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { CheckpointStatus } from '@/components/Learn/ModuleCard';
import { minutes, PageShell, SectionHead, StateIcon } from '@/components/Learn/parts';
import { QuestionCard } from '@/components/Learn/QuestionCard';
import { TrackList } from '@/components/Learn/TrackCard';
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
const fmtShort = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * L7 — track completion: the shared page header, one line of what you did (not four tiles), checkpoint scores,
 * badges earned, problems to practise and what comes next. Before the track is done it is the list of what is left.
 */
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
        <div className={s.trackHead}>
          <PageHeader
            title={`Almost there: ${track.title}`}
            subtitle={`Finish every lesson and pass every module checkpoint to complete the track. ${remaining.length} step${remaining.length === 1 ? '' : 's'} to go.`}
            actions={
              step && (
                <ButtonLink
                  href={stepHref(track.slug, step)}
                  variant="primary"
                  size="lg"
                  iconRight="arrow-right"
                  className={s.headCta}
                  data-testid="learn-primary-action"
                >
                  {step.kind === 'lesson' ? `Continue: ${step.title}` : `Take the ${step.moduleTitle} checkpoint`}
                </ButtonLink>
              )
            }
          />
          <div className={s.progressLine}>
            <ProgressBar value={p.percent} aria-label="Track progress" valueText={`${p.percent}%`} />
            <span>
              {p.lessonsDone} of {p.lessonsTotal} lessons · {p.checkpointsPassed} of {p.checkpointsTotal} checkpoints
            </span>
          </div>
        </div>
        <section aria-labelledby="remaining-title">
          <SectionHead title="Still to do" id="remaining-title" />
          <div className={s.module}>
            <ul className={s.items}>
              {remaining.map((st) => (
                <li key={st.kind === 'lesson' ? st.lessonSlug : `${st.moduleSlug}-cp`} className={s.item}>
                  <Link href={stepHref(track.slug, st)}>
                    <StateIcon state={st.kind === 'lesson' ? (lessonState.get(st.lessonSlug) ?? 'not_started') : 'not_started'} />
                    <span className={s.itemTitle}>{st.kind === 'lesson' ? st.title : `Checkpoint: ${st.moduleTitle}`}</span>
                    <span className={s.itemMeta}>{st.kind === 'lesson' ? minutes(st.estMinutes) : `${st.questions} questions`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
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
  const did = [
    `${p.lessonsDone} lesson${p.lessonsDone === 1 ? '' : 's'} completed`,
    `${p.checkpointsPassed} checkpoint${p.checkpointsPassed === 1 ? '' : 's'} passed`,
    avg !== null && `average best score ${avg}%`,
    `${minutes(p.estMinutes)} of reading`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageShell narrow>
      {crumbs}
      <div className={s.trackHead}>
        <PageHeader
          title={`You finished ${track.title}`}
          subtitle={`Every lesson read and every checkpoint passed${p.completedAt ? ` — completed ${fmtDate(p.completedAt)}` : ''}.`}
          actions={
            <>
              {viewer.handle && (
                <ButtonLink href={`/u/${viewer.handle}`} variant="default" icon="user" className={s.headBtn}>
                  Your profile
                </ButtonLink>
              )}
              <ButtonLink href={`/learn/${track.slug}`} variant="default" icon="list" className={s.headBtn}>
                Review lessons
              </ButtonLink>
            </>
          }
        />
        <p className={s.facts}>{did}</p>
      </div>

      {scores.length > 0 && (
        <section aria-labelledby="scores-title">
          <SectionHead title="Checkpoint scores" id="scores-title" />
          <div className={s.module}>
            <ul className={s.scoreList}>
              {scores.map(({ mod, cp }) => (
                <li key={mod.slug}>
                  <Link href={`/learn/${track.slug}/${mod.slug}/checkpoint`} className="focus-ring">
                    <span>{mod.title}</span>
                    <CheckpointStatus summary={cp} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section aria-labelledby="badges-title">
        <SectionHead title="Learning badges" id="badges-title" note={c.badges.length ? `${c.badges.length} earned` : undefined} />
        {c.badges.length === 0 ? (
          <p className={s.note}>No learning badges yet — they unlock as you complete lessons and tracks.</p>
        ) : (
          <ul className={bs.cards}>
            {c.badges.map((b) => (
              <li key={b.slug}>
                <Link
                  href={viewer.handle ? `/u/${viewer.handle}/badges?badge=${b.slug}` : '/profile'}
                  className={`${bs.card} focus-ring`}
                  style={{ textDecoration: 'none' }}
                  data-earned="true"
                >
                  <BadgeMedallion icon={b.icon} rarity={b.rarity} size={44} />
                  <span className={bs.cardBody}>
                    <span className={bs.cardTop}>
                      <span className={bs.cardName}>{b.name}</span>
                      <span className={bs.cardRarity}>{RARITY[b.rarity].label}</span>
                    </span>
                    <span className={bs.cardState}>
                      <span className={bs.cardDate}>
                        <Icon name="check-circle" size={12} />
                        Earned {b.awardedAt ? fmtShort(b.awardedAt) : ''}
                      </span>
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
          <ul className={s.linkGrid}>
            {c.practice.map((q) => (
              <li key={q.slug}>
                <QuestionCard slug={q.slug} question={q} kicker={null} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {c.nextTrack && (
        <section aria-labelledby="next-title">
          <SectionHead title="Up next" id="next-title" />
          <TrackList items={[c.nextTrack]} label="Up next" />
        </section>
      )}
    </PageShell>
  );
}
