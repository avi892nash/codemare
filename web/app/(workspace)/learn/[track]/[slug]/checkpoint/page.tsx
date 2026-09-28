import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Icon } from '@/components/ui/Icon';
import { CheckpointQuiz } from '@/components/Learn/CheckpointQuiz';
import { CheckpointReview } from '@/components/Learn/CheckpointReview';
import { CheckpointStatus } from '@/components/Learn/ModuleCard';
import { LessonOutline, Pager } from '@/components/Learn/LessonOutline';
import { PageShell } from '@/components/Learn/parts';
import { Prose } from '@/components/Learn/Prose';
import s from '@/components/Learn/learn.module.css';
import { requireViewer } from '@/components/Learn/viewer';
import { getCheckpointReview, getCheckpointView, getLearnTitles } from '@/lib/server/learnViews';
import { nextUnfinishedAfter, stepHref } from '@/lib/server/rules/learnProgress';
import { submitCheckpointAction } from '../../../actions';

type Params = { track: string; slug: string };
type Search = { attempt?: string | string[] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { track, slug } = await params;
  const titles = await getLearnTitles(track, { module: slug });
  return { title: titles?.item ? `Checkpoint: ${titles.item} · ${titles.track} · Codemare` : 'Learn · Codemare' };
}

/**
 * L6 — a module checkpoint. Without `?attempt=` it is the quiz; with the id
 * of one of the viewer's attempts it is that attempt's graded review.
 */
export default async function CheckpointPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
  const [{ track: trackSlug, slug: moduleSlug }, search] = await Promise.all([params, searchParams]);
  const base = `/learn/${trackSlug}/${moduleSlug}/checkpoint`;
  const viewer = await requireViewer(base);
  const view = await getCheckpointView(viewer.id, trackSlug, moduleSlug);
  if (!view) notFound();
  const { track, module: mod, moduleIndex, moduleProgress, nav } = view;

  const attemptId = typeof search.attempt === 'string' && /^[a-z0-9]{8,40}$/i.test(search.attempt) ? search.attempt : null;
  const review = attemptId ? await getCheckpointReview(viewer.id, mod.id, attemptId) : null;
  const passPercent = Math.round(view.passRatio * 100);
  const summary = moduleProgress.checkpoint!;

  // Where to go after a passing review: the next unfinished step, or the completion page.
  const after = nextUnfinishedAfter(track, view.progress, { kind: 'checkpoint', moduleSlug: mod.slug });
  const continueTo = after
    ? { href: stepHref(track.slug, after), label: after.kind === 'lesson' ? 'Next lesson' : 'Next checkpoint' }
    : { href: `/learn/${track.slug}/complete`, label: 'Track summary' };

  return (
    <PageShell>
      <Breadcrumb
        items={[
          { label: 'Learn', href: '/learn', icon: 'graduation' },
          { label: track.title, href: `/learn/${track.slug}` },
          { label: `${mod.title} checkpoint` },
        ]}
      />
      <div className={s.lessonLayout}>
        <article className={s.article} aria-labelledby="checkpoint-title">
          <header className={s.header}>
            <span className={s.eyebrow}>
              <Icon name="target" size={13} /> Module {moduleIndex + 1} checkpoint
            </span>
            <h1 className={s.title} id="checkpoint-title">
              {review ? `Results: ${mod.title}` : mod.title}
            </h1>
            <div className={s.meta}>
              <span className={s.metaItem}>
                <Icon name="list" size={13} />
                {view.questions.length} questions
              </span>
              <span className={s.metaItem}>
                <Icon name="check-circle" size={13} />
                Pass with {passPercent}%
              </span>
              {summary.attempts > 0 && (
                <>
                  <CheckpointStatus summary={summary} />
                  <span className={s.metaItem}>
                    {summary.attempts} attempt{summary.attempts === 1 ? '' : 's'}
                  </span>
                </>
              )}
            </div>
            {!review && (
              <p className={s.subtitle}>
                Check what stuck from this module. Answers are graded when you submit, then you get an explanation for every
                question. Retake it as often as you like.
              </p>
            )}
          </header>

          {review ? (
            <CheckpointReview review={review} passPercent={passPercent} retakeHref={base} continueTo={review.attempt.passed ? continueTo : null} />
          ) : (
            <CheckpointQuiz
              trackSlug={track.slug}
              moduleSlug={mod.slug}
              passPercent={passPercent}
              submit={submitCheckpointAction}
              questions={view.questions.map((q) => ({
                id: q.id,
                kind: q.kind,
                prompt: <Prose md={q.promptMd} compact />,
                choices: q.choices.map((c, k) => <Prose key={k} md={c} inline />),
              }))}
            />
          )}

          <Pager trackSlug={track.slug} prev={nav.prev} next={nav.next} />
        </article>

        <aside className={s.aside}>
          <LessonOutline
            track={track}
            mod={mod}
            moduleIndex={moduleIndex}
            moduleProgress={moduleProgress}
            trackProgress={view.progress}
            current={{ kind: 'checkpoint' }}
          />
        </aside>
      </div>
    </PageShell>
  );
}
