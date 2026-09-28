import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { EmptyState } from '@/components/states/EmptyState';
import { getLibraryIndex } from '@/lib/server/library';
import s from '@/components/Library/library.module.css';
import { LIBRARY_ROBOTS, libraryViewer, NOT_FOUND_METADATA, requireLibraryViewer } from './viewer';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  if (!(await libraryViewer())) return NOT_FOUND_METADATA;
  return { title: 'Library · Codemare', robots: LIBRARY_ROBOTS };
}

/** /library — the master index: every area with its reading progress. */
export default async function LibraryIndexPage() {
  const viewer = await requireLibraryViewer();
  const index = await getLibraryIndex(viewer);
  const { totals, next } = index;

  return (
    <main className={`${s.page} scroll`}>
      <div className={s.wrap}>
        <header>
          <p className={s.eyebrow}>Library</p>
          <h1 className={s.h1}>Algorithms library</h1>
          <p className={s.lede}>
            Reference notes on the ideas behind the problems: the intuition, the math, runnable C++, a step-by-step
            visualization, and where each technique shows up.
          </p>
          {!viewer.isPublic && (
            <div className={s.hidden}>
              <Pill tone="warn" icon="eye-off" size="sm">
                Hidden · staff preview
              </Pill>
              <span>Not linked from anywhere and not indexed. Everyone else gets a 404 until FEATURE_LIBRARY_PUBLIC is on.</span>
            </div>
          )}
        </header>

        {index.areas.length === 0 ? (
          <div style={{ marginTop: 24 }}>
            <EmptyState icon="book-open" title="No articles yet" description="Seed the library content (web/prisma/seed/data/library) to fill it." />
          </div>
        ) : (
          <>
            <section className={s.progressCard} aria-labelledby="library-progress">
              <div style={{ minWidth: 0 }}>
                <div className={s.progressStat}>
                  <h2 id="library-progress" className="sr-only">
                    Reading progress
                  </h2>
                  <span className={s.bigNum}>{totals.read}</span>
                  <span className={s.bigNumOf}>/ {totals.articles}</span>
                  <span className={s.statLabel}>articles read · {totals.minutes} min of reading in total</span>
                </div>
                <ProgressBar
                  value={totals.read}
                  max={totals.articles}
                  tone={totals.read === totals.articles ? 'ok' : 'accent'}
                  aria-label="Articles read"
                  valueText={`${totals.read} of ${totals.articles} articles`}
                  height={6}
                />
              </div>
              {next ? (
                <ButtonLink href={`/library/${next.areaSlug}/${next.slug}`} variant="primary" iconRight="arrow-right">
                  {totals.read === 0 ? 'Start' : 'Continue'}: {next.title}
                </ButtonLink>
              ) : (
                <Pill tone="ok" icon="trophy" size="md">
                  Everything read
                </Pill>
              )}
            </section>

            <ul className={s.areaGrid} aria-label="Areas">
              {index.areas.map((area) => (
                <li key={area.slug}>
                  <Link href={`/library/${area.slug}`} className={`${s.areaCard} focus-ring`}>
                    <span className={s.areaTop}>
                      <span className={s.areaIcon} aria-hidden="true">
                        <Icon name={area.icon} size={18} />
                      </span>
                      <h2 className={s.areaTitle}>{area.title}</h2>
                    </span>
                    <p className={s.areaSummary}>{area.summary}</p>
                    <span className={s.areaMeta}>
                      {area.chapters} chapter{area.chapters === 1 ? '' : 's'} · {area.articles} article{area.articles === 1 ? '' : 's'} ·{' '}
                      {area.minutes} min
                    </span>
                    <span className={s.areaFoot}>
                      <ProgressBar
                        value={area.read}
                        max={area.articles}
                        tone={area.read === area.articles ? 'ok' : 'accent'}
                        aria-label={`${area.title}: articles read`}
                        valueText={`${area.read} of ${area.articles}`}
                      />
                      <span className={s.areaDone}>
                        {area.read}/{area.articles} read
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
