import { Button, ButtonLink } from '@/components/ui/Button';
import { pageWindow } from './pageWindow';
import s from './Pagination.module.css';

export interface PaginationProps {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  /** Plural noun for the summary line ("problems", "submissions"). */
  noun: string;
  /** URL of a given page (keeps the current filters). */
  hrefFor: (page: number) => string;
}

/**
 * "Showing 21–40 of 132" + Previous / numbered pages / Next. Links are real
 * <a>s (middle-click works); the current page carries aria-current. Phones
 * get Previous · "Page 2 of 7" · Next. Server component; renders nothing for
 * an empty list.
 */
export function Pagination({ page, pageCount, pageSize, total, noun, hrefFor }: PaginationProps) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className={s.pager} aria-label="Pagination">
      <p className={s.pagerInfo}>
        Showing <span>{from}–{to}</span> of <span>{total}</span> {noun}
      </p>
      {pageCount > 1 && (
        <div className={s.pagerLinks}>
          {page > 1 ? (
            <ButtonLink href={hrefFor(page - 1)} size="sm" icon="chev-left" rel="prev">
              Previous
            </ButtonLink>
          ) : (
            <Button size="sm" icon="chev-left" disabled>
              Previous
            </Button>
          )}
          <ol className={s.pages}>
            {pageWindow(page, pageCount).map((p, i) =>
              p === null ? (
                <li key={`gap-${i}`} className={s.gap} aria-hidden="true">
                  …
                </li>
              ) : (
                <li key={p}>
                  <ButtonLink
                    href={hrefFor(p)}
                    size="sm"
                    variant={p === page ? 'accent' : 'ghost'}
                    aria-current={p === page ? 'page' : undefined}
                    aria-label={`Page ${p}`}
                    className="mono"
                  >
                    {p}
                  </ButtonLink>
                </li>
              )
            )}
          </ol>
          <span className={s.pageOf}>
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <ButtonLink href={hrefFor(page + 1)} size="sm" iconRight="chev-right" rel="next">
              Next
            </ButtonLink>
          ) : (
            <Button size="sm" iconRight="chev-right" disabled>
              Next
            </Button>
          )}
        </div>
      )}
    </nav>
  );
}
