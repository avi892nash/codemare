import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { signInHref } from '@/components/Auth/routes';
import { CatalogFilters } from '@/components/Catalog/CatalogFilters';
import { CatalogColumnHead, CatalogRows } from '@/components/Catalog/CatalogRows';
import { FilterNavProvider, PendingRegion } from '@/components/Catalog/FilterNav';
import { Pagination } from '@/components/Catalog/Pagination';
import { catalogHref, catalogSearchString, hasActiveFilters, parseCatalogQuery } from '@/components/Catalog/query';
import { EmptyState } from '@/components/states/EmptyState';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { listCatalog } from '@/lib/server/catalog';
import s from '@/components/Catalog/Catalog.module.css';

export const metadata: Metadata = { title: 'Problems · Codemare' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * 01 · Catalog. Published questions, filtered by the URL (see
 * components/Catalog/query.ts), 20 per page, with this user's progress, a
 * lock on questions whose topics aren't unlocked (those link to /map) and
 * acceptance. 08b · empty state when nothing matches.
 */
export default async function ProblemsPage({ searchParams }: { searchParams: SearchParams }) {
  const [session, sp] = await Promise.all([auth(), searchParams]);
  const query = parseCatalogQuery(sp);
  if (!session?.user?.id) {
    const qs = catalogSearchString(query);
    redirect(signInHref(qs ? `/problems?${qs}` : '/problems'));
  }

  const data = await listCatalog(session.user.id, query);
  const current = { ...query, page: data.page };
  const filtered = hasActiveFilters(query);

  return (
    <main className={`scroll ${s.main}`}>
      <div className={s.page}>
        <header className={s.head}>
          <div>
            <p className={s.eyebrow}>
              <Icon name="list" size={13} /> Practice
            </p>
            <h1 className={s.title}>Problems</h1>
            <p className={s.sub}>
              Curated problems, judged in a sandbox and timed to the microsecond. Locked ones open as you unlock
              their topics on the map.
            </p>
          </div>
          {data.summary.questions > 0 && (
            <ProgressBar
              className={s.solved}
              label="Solved"
              value={data.summary.solved}
              max={data.summary.questions}
              showValue
              valueText={`${data.summary.solved} / ${data.summary.questions}`}
              tone="ok"
            />
          )}
        </header>

        <FilterNavProvider>
          <div className={s.table}>
            <div className={s.sticky}>
              <CatalogFilters query={current} facets={data.facets} total={data.total} />
              {data.total > 0 && <CatalogColumnHead />}
            </div>

            <PendingRegion className={s.results}>
              {data.total > 0 ? (
                <CatalogRows rows={data.rows} />
              ) : (
                <div className={s.empty}>
                  {data.summary.questions === 0 ? (
                    <EmptyState
                      icon="layers"
                      title="No problems yet"
                      description="Published problems will show up here."
                    />
                  ) : (
                    <EmptyState
                      icon="search"
                      title="No problems match these filters"
                      description={
                        query.q
                          ? `Nothing matches “${query.q}” with the current filters. Try another word or remove a filter.`
                          : 'Try removing a filter or two.'
                      }
                      action={
                        filtered ? (
                          <ButtonLink href="/problems" variant="default" icon="x">
                            Clear filters
                          </ButtonLink>
                        ) : undefined
                      }
                    />
                  )}
                </div>
              )}
            </PendingRegion>

            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              pageSize={data.pageSize}
              total={data.total}
              noun={data.total === 1 ? 'problem' : 'problems'}
              hrefFor={(p) => catalogHref(current, { page: p })}
            />
          </div>
        </FilterNavProvider>
      </div>
    </main>
  );
}
