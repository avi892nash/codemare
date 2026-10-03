import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { signInHref } from '@/components/Auth/routes';
import { FilterNavProvider, PendingRegion } from '@/components/Filters/FilterNav';
import { Pagination } from '@/components/Filters/Pagination';
import { EmptyState } from '@/components/states/EmptyState';
import { SubmissionFilters } from '@/components/Submissions/SubmissionFilters';
import { SubmissionColumnHead, SubmissionRows } from '@/components/Submissions/SubmissionRows';
import { parseSubmissionQuery, submissionsHref } from '@/components/Submissions/query';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { listUserSubmissions } from '@/lib/server/submissionHistory';
import s from '@/components/Submissions/Submissions.module.css';

export const metadata: Metadata = { title: 'Submissions · Codemare' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 05 · The signed-in user's submissions, newest first; ?status=&language=&kind=&page=. */
export default async function SubmissionsPage({ searchParams }: { searchParams: SearchParams }) {
  const [session, sp] = await Promise.all([auth(), searchParams]);
  const query = parseSubmissionQuery(sp);
  if (!session?.user?.id) redirect(signInHref(submissionsHref(query)));

  const data = await listUserSubmissions(session.user.id, query);
  const current = { ...query, page: data.page };
  const now = new Date();

  return (
    <main className={`scroll ${s.main}`}>
      <div className={s.page}>
        <PageHeader title="Submissions" subtitle="Every run, submit and gate attempt, newest first." />

        {!data.hasAny ? (
          <div className={s.empty}>
            <EmptyState
              icon="history"
              title="No submissions yet"
              description="Run or submit a solution and it lands here with its runtime, memory and per-test results."
              action={
                <ButtonLink href="/map" variant="primary" iconRight="arrow-right">
                  Find a problem on the map
                </ButtonLink>
              }
            />
          </div>
        ) : (
          <FilterNavProvider>
            <SubmissionFilters query={current} total={data.total} />
            <PendingRegion className={s.list}>
              {data.total > 0 ? (
                <>
                  <SubmissionColumnHead />
                  <SubmissionRows rows={data.rows} now={now} />
                </>
              ) : (
                <div className={s.empty}>
                  <EmptyState
                    icon="filter"
                    title="No submissions match these filters"
                    description="Try another status, language or kind."
                    action={
                      <ButtonLink href="/submissions" variant="default" icon="x">
                        Clear filters
                      </ButtonLink>
                    }
                  />
                </div>
              )}
            </PendingRegion>
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              pageSize={data.pageSize}
              total={data.total}
              noun={data.total === 1 ? 'submission' : 'submissions'}
              hrefFor={(p) => submissionsHref(current, { page: p })}
            />
          </FilterNavProvider>
        )}
      </div>
    </main>
  );
}
