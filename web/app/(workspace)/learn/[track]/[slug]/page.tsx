import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { LessonComplete } from '@/components/Learn/LessonComplete';
import { LessonMarkdown } from '@/components/Learn/LessonMarkdown';
import { LessonOutline, Pager } from '@/components/Learn/LessonOutline';
import { minutes, PageShell, SectionHead } from '@/components/Learn/parts';
import { QuestionCard } from '@/components/Learn/QuestionCard';
import s from '@/components/Learn/learn.module.css';
import { requireViewer } from '@/components/Learn/viewer';
import { findModuleId, getLearnTitles, getLessonView } from '@/lib/server/learnViews';
import { nextUnfinishedAfter, stepHref } from '@/lib/server/rules/learnProgress';
import { completeLessonAction, runSnippet, startLessonAction } from '../../actions';

type Params = { track: string; slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { track, slug } = await params;
  const titles = await getLearnTitles(track, { lesson: slug });
  return { title: titles?.item ? `${titles.item} · ${titles.track} · Codemare` : 'Learn · Codemare' };
}

/** L1 — a lesson: prose, runnable code, visualizations, mark complete, related questions. */
export default async function LessonPage({ params }: { params: Promise<Params> }) {
  const { track: trackSlug, slug } = await params;
  const viewer = await requireViewer(`/learn/${trackSlug}/${slug}`);
  const view = await getLessonView(viewer.id, trackSlug, slug);
  if (!view) {
    // A module slug here (a guessed URL) goes to that module on the track page.
    if (await findModuleId(trackSlug, slug)) redirect(`/learn/${trackSlug}#module-${slug}`);
    notFound();
  }
  const { track, module: mod, moduleIndex, lesson, nav } = view;

  // After finishing: the next unfinished step (not merely the next one), else the summary.
  const after = nextUnfinishedAfter(track, view.progress, { kind: 'lesson', moduleSlug: mod.slug, lessonSlug: lesson.slug });
  const next = after
    ? { href: stepHref(track.slug, after), label: after.kind === 'lesson' ? after.title : `${after.moduleTitle} checkpoint` }
    : { href: `/learn/${track.slug}/complete`, label: 'Track summary' };
  const related = lesson.relatedQuestionSlugs;

  return (
    <PageShell>
      <Breadcrumb
        items={[
          { label: 'Learn', href: '/learn', icon: 'graduation' },
          { label: track.title, href: `/learn/${track.slug}` },
          { label: lesson.title },
        ]}
      />
      <div className={s.lessonLayout}>
        <article className={s.article} aria-labelledby="lesson-title">
          <PageHeader
            title={lesson.title}
            titleId="lesson-title"
            subtitle={
              <>
                Module {moduleIndex + 1} · {mod.title} · {minutes(lesson.estMinutes)}
                {lesson.state === 'completed' && (
                  <>
                    {' · '}
                    <span className={s.status} data-tone="ok">
                      <Icon name="check" size={12} />
                      Completed
                    </span>
                  </>
                )}
              </>
            }
          />

          <LessonMarkdown blocks={view.blocks} questions={view.questions} runSnippet={runSnippet} />

          <LessonComplete
            trackSlug={track.slug}
            lessonSlug={lesson.slug}
            completed={lesson.state === 'completed'}
            next={next}
            startLesson={startLessonAction}
            completeLesson={completeLessonAction}
          />

          <Pager trackSlug={track.slug} prev={nav.prev} next={nav.next} />

          {related.length > 0 && (
            <section aria-labelledby="practice-title">
              <SectionHead title="Practice what you learned" id="practice-title" />
              <ul className={s.linkGrid}>
                {related.map((q) => (
                  <li key={q}>
                    <QuestionCard slug={q} question={view.questions.get(q)} kicker={null} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </article>

        <aside className={s.aside}>
          <LessonOutline
            track={track}
            mod={mod}
            moduleIndex={moduleIndex}
            moduleProgress={view.moduleProgress}
            trackProgress={view.progress}
            current={{ kind: 'lesson', slug: lesson.slug }}
          />
        </aside>
      </div>
    </PageShell>
  );
}
