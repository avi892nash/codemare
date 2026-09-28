import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Callout } from '@/components/ui/Callout';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Formula } from '@/components/ui/Formula';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ArticleCode } from '@/components/Library/ArticleCode';
import { ArticleViz } from '@/components/Library/ArticleViz';
import { Markdown } from '@/components/Library/Markdown';
import { MarkRead } from '@/components/Library/MarkRead';
import { getLibraryArticle } from '@/lib/server/library';
import s from '@/components/Library/library.module.css';
import { LIBRARY_ROBOTS, libraryViewer, NOT_FOUND_METADATA, requireLibraryViewer } from '../../viewer';

export const dynamic = 'force-dynamic';

type Params = Promise<{ area: string; article: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const viewer = await libraryViewer();
  const { area, article } = await params;
  const a = viewer ? await getLibraryArticle(viewer, area, article) : null;
  if (!a) return NOT_FOUND_METADATA;
  return { title: `${a.title} · Library · Codemare`, description: a.summary, robots: LIBRARY_ROBOTS };
}

function Block({ id, title, icon, note, children }: { id: string; title: string; icon: IconName; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={s.block} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={s.blockTitle}>
        <Icon name={icon} size={16} />
        {title}
      </h2>
      {note && <p className={s.blockNote}>{note}</p>}
      {children}
    </section>
  );
}

function day(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * /library/[area]/[article] — idea, formula, runnable C++, visualization,
 * applications, pitfalls and practice, then "mark as read" and neighbours.
 */
export default async function LibraryArticlePage({ params }: { params: Params }) {
  const viewer = await requireLibraryViewer();
  const { area: areaSlug, article: articleSlug } = await params;
  const a = await getLibraryArticle(viewer, areaSlug, articleSlug);
  if (!a) notFound();

  const sections = [
    { id: 'idea', label: 'Idea' },
    ...(a.formula ? [{ id: 'formula', label: 'Formula' }] : []),
    { id: 'implementation', label: 'Implementation' },
    ...(a.vizId ? [{ id: 'visualization', label: 'Visualization' }] : []),
    { id: 'applications', label: 'Applications' },
    { id: 'pitfalls', label: 'Pitfalls' },
    ...(a.practice.length ? [{ id: 'practice', label: 'Practice' }] : []),
  ];

  return (
    <main className={`${s.page} scroll`}>
      <div className={s.wrap}>
        <Breadcrumb
          items={[
            { label: 'Library', href: '/library', icon: 'book-open' },
            { label: a.area.title, href: `/library/${a.area.slug}` },
            { label: a.title },
          ]}
        />
        <header style={{ marginTop: 14 }}>
          <p className={s.eyebrow}>
            Chapter {a.chapter.index} · {a.chapter.title} · article {a.position.index} of {a.position.total}
          </p>
          <h1 id="article-title" className={s.h1}>
            {a.title}
          </h1>
          <p className={s.lede}>{a.summary}</p>
          <div className={s.meta}>
            <DifficultyPill level={a.difficulty} />
            <span className={s.metaItem}>
              <Icon name="clock" size={13} />
              {a.readingMinutes} min read
            </span>
            {a.status === 'draft' && (
              <Pill tone="warn" size="sm">
                Draft · staff only
              </Pill>
            )}
            {a.readAt ? (
              <Pill tone="ok" icon="check-circle" size="sm">
                Read · {day(a.readAt)}
              </Pill>
            ) : (
              <span className={s.metaItem}>
                <Icon name="circle" size={13} />
                Unread
              </span>
            )}
          </div>
        </header>

        <div className={s.articleGrid}>
          <article className={s.articleBody} aria-labelledby="article-title">
            <Block id="idea" title="Idea" icon="lightbulb">
              <Markdown headingOffset={2}>{a.ideaMd}</Markdown>
            </Block>

            {a.formula && (
              <Block id="formula" title="Formula" icon="hash">
                <Formula tex={a.formula} style={{ margin: 0 }} />
              </Block>
            )}

            <Block id="implementation" title="Implementation" icon="code" note="Edit it and run it — the program compiles and runs in the judge's sandbox (C++17).">
              <ArticleCode code={a.codeCpp} filename={`${a.slug}.cpp`} />
            </Block>

            {a.vizId && (
              <Block id="visualization" title="Visualization" icon="play" note="Step through with the controls, or focus it and use ← → and Space.">
                <ArticleViz id={a.vizId} />
              </Block>
            )}

            <Block id="applications" title="Applications" icon="target">
              <Markdown headingOffset={2}>{a.applicationsMd}</Markdown>
            </Block>

            <Block id="pitfalls" title="Pitfalls" icon="alert">
              <Callout kind="pitfall" title="Watch out for">
                <Markdown headingOffset={3} size="sm">
                  {a.pitfallMd}
                </Markdown>
              </Callout>
            </Block>

            {a.practice.length > 0 && (
              <Block id="practice" title="Practice" icon="list" note="Problems in the catalog where this technique does the heavy lifting.">
                <ul className={s.practiceList}>
                  {a.practice.map((q) => (
                    <li key={q.slug}>
                      <Link href={`/problems/${q.slug}`} className={`${s.practiceCard} focus-ring`}>
                        <Icon name="code" size={16} style={{ color: 'var(--fg-3)' }} />
                        <span className={s.practiceTitle}>
                          {q.title}
                          <span className={s.practiceSlug}>{q.slug}</span>
                        </span>
                        <DifficultyPill level={q.difficulty} size="xs" />
                        <Icon name="arrow-right" size={14} style={{ color: 'var(--fg-3)' }} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            <footer className={s.foot}>
              <div className={s.readRow}>
                <MarkRead articleId={a.id} readAt={a.readAt ? a.readAt.toISOString() : null} />
                <span className={s.readHint}>{a.readAt ? 'Counted in your library progress.' : 'Adds this article to your reading progress.'}</span>
              </div>
              {(a.prev || a.next) && (
                <nav className={s.pager} aria-label="More articles in this area">
                  {a.prev && (
                    <Link href={`/library/${a.prev.areaSlug}/${a.prev.slug}`} className={`${s.pagerLink} focus-ring`} rel="prev">
                      <span className={s.pagerDir}>
                        <Icon name="chev-left" size={12} />
                        Previous
                      </span>
                      <span className={s.pagerTitle}>{a.prev.title}</span>
                    </Link>
                  )}
                  {a.next && (
                    <Link href={`/library/${a.next.areaSlug}/${a.next.slug}`} className={`${s.pagerLink} ${s.pagerNext} focus-ring`} rel="next">
                      <span className={s.pagerDir}>
                        Next
                        <Icon name="chev-right" size={12} />
                      </span>
                      <span className={s.pagerTitle}>{a.next.title}</span>
                    </Link>
                  )}
                </nav>
              )}
            </footer>
          </article>

          <nav className={s.toc} aria-label="On this page">
            <span className={s.tocTitle}>On this page</span>
            <ol>
              {sections.map((sec) => (
                <li key={sec.id}>
                  <a href={`#${sec.id}`} className="focus-ring">
                    {sec.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </div>
    </main>
  );
}
