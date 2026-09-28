import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { ButtonLink } from '@/components/ui/Button';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { getLibraryArea } from '@/lib/server/library';
import s from '@/components/Library/library.module.css';
import { LIBRARY_ROBOTS, libraryViewer, NOT_FOUND_METADATA, requireLibraryViewer } from '../viewer';

export const dynamic = 'force-dynamic';

type Params = Promise<{ area: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const viewer = await libraryViewer();
  const area = viewer ? await getLibraryArea(viewer, (await params).area) : null;
  if (!area) return NOT_FOUND_METADATA;
  return { title: `${area.title} · Library · Codemare`, robots: LIBRARY_ROBOTS };
}

/** /library/[area] — chapters in order, each article with its metadata and read state. */
export default async function LibraryAreaPage({ params }: { params: Params }) {
  const viewer = await requireLibraryViewer();
  const area = await getLibraryArea(viewer, (await params).area);
  if (!area) notFound();
  const { totals } = area;

  return (
    <main className={`${s.page} scroll`}>
      <div className={s.wrap}>
        <Breadcrumb items={[{ label: 'Library', href: '/library', icon: 'book-open' }, { label: area.title }]} />
        <header className={s.areaHead}>
          <span className={`${s.areaIcon} ${s.areaIconLg}`} aria-hidden="true">
            <Icon name={area.icon} size={22} />
          </span>
          <div style={{ minWidth: 0 }}>
            <p className={s.eyebrow}>
              {area.chapters.length} chapter{area.chapters.length === 1 ? '' : 's'} · {totals.articles} articles · {totals.minutes} min
            </p>
            <h1 className={s.h1}>{area.title}</h1>
            <p className={s.lede}>{area.summary}</p>
          </div>
        </header>

        <section className={s.progressCard} aria-labelledby="area-progress">
          <div style={{ minWidth: 0 }}>
            <div className={s.progressStat}>
              <h2 id="area-progress" className="sr-only">
                Reading progress
              </h2>
              <span className={s.bigNum}>{totals.read}</span>
              <span className={s.bigNumOf}>/ {totals.articles}</span>
              <span className={s.statLabel}>read in this area</span>
            </div>
            <ProgressBar
              value={totals.read}
              max={totals.articles}
              tone={totals.read === totals.articles ? 'ok' : 'accent'}
              aria-label={`${area.title}: articles read`}
              valueText={`${totals.read} of ${totals.articles} articles`}
              height={6}
            />
          </div>
          {area.next ? (
            <ButtonLink href={`/library/${area.slug}/${area.next.slug}`} variant="primary" iconRight="arrow-right">
              {totals.read === 0 ? 'Start' : 'Continue'}: {area.next.title}
            </ButtonLink>
          ) : (
            <Pill tone="ok" icon="trophy" size="md">
              Area complete
            </Pill>
          )}
        </section>

        {area.chapters.map((chapter, ci) => (
          <section key={chapter.slug} className={s.chapter} aria-labelledby={`chapter-${chapter.slug}`}>
            <h2 id={`chapter-${chapter.slug}`} className={s.chapterTitle}>
              <span className={s.chapterNum}>Chapter {ci + 1}</span>
              {chapter.title}
            </h2>
            <ol className={s.articleList}>
              {chapter.articles.map((a, ai) => (
                <li key={a.slug}>
                  <Link href={`/library/${area.slug}/${a.slug}`} className={s.articleRow}>
                    <span className={s.articleNum} aria-hidden="true">
                      {ci + 1}.{ai + 1}
                    </span>
                    <span className={s.articleMain}>
                      <span className={s.articleTitle}>{a.title}</span>
                      <span className={s.articleSummary}>{a.summary}</span>
                      <span className={s.articleTags}>
                        <DifficultyPill level={a.difficulty} size="xs" />
                        <span className={s.tag}>
                          <Icon name="clock" size={12} />
                          {a.readingMinutes} min
                        </span>
                        {a.hasFormula && (
                          <span className={s.tag}>
                            <Icon name="hash" size={12} />
                            formula
                          </span>
                        )}
                        <span className={s.tag}>
                          <Icon name="code" size={12} />
                          C++
                        </span>
                        {a.hasViz && (
                          <span className={s.tag}>
                            <Icon name="play" size={12} />
                            visualization
                          </span>
                        )}
                        {a.practice > 0 && (
                          <span className={s.tag}>
                            <Icon name="target" size={12} />
                            {a.practice} practice
                          </span>
                        )}
                        {a.status === 'draft' && (
                          <Pill tone="warn" size="xs">
                            draft
                          </Pill>
                        )}
                      </span>
                    </span>
                    <span className={s.articleState}>
                      {a.readAt ? (
                        <Pill tone="ok" icon="check" size="xs">
                          Read
                        </Pill>
                      ) : (
                        <span className={s.unread}>Unread</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </main>
  );
}
