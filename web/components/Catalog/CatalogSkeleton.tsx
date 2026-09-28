import { Skeleton } from '@/components/ui/Skeleton';
import s from './Catalog.module.css';

/**
 * Placeholder shaped like the catalog (header, toolbar, column head, rows),
 * so the page doesn't jump when data lands. Decorative: the caller wraps it
 * in a role="status" region with a text label.
 */
export function CatalogSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className={s.main} aria-hidden="true">
      <div className={s.page}>
        <div className={s.head}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
            <Skeleton width={64} height={10} />
            <Skeleton width={170} height={26} radius={6} />
            <Skeleton width="min(520px, 90%)" height={12} />
          </div>
          <div className={s.solved} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Skeleton width="100%" height={10} />
            <Skeleton width="100%" height={4} />
          </div>
        </div>
        <div className={s.table}>
          <div className={s.filters} style={{ paddingTop: 8 }}>
            <div className={s.searchRow}>
              <Skeleton height={32} radius={6} style={{ flex: 1 }} />
              {/* Phones: the Filters toggle stands in for the folded facets. */}
              <span className={s.toggle}>
                <Skeleton width={84} height={32} radius={6} />
              </span>
            </div>
            <div className={s.panel}>
              {[66, 84, 66].map((w, i) => (
                <Skeleton key={i} width={w} height={26} radius={999} />
              ))}
              {[132, 132, 110, 124].map((w, i) => (
                <Skeleton key={`s${i}`} width={w} height={28} radius={6} />
              ))}
            </div>
            <Skeleton width={90} height={12} />
          </div>
          <div className={s.colHead}>
            <Skeleton width={12} height={10} />
          </div>
          <div className={s.rows}>
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className={s.row} style={{ borderTop: i ? '1px solid var(--line-1)' : undefined }}>
                <span className={s.cStatus}>
                  <Skeleton circle height={16} />
                </span>
                <span className={s.cTitle}>
                  <Skeleton width={`${42 + ((i * 17) % 34)}%`} height={12} />
                </span>
                <span className={s.cTopics}>
                  <Skeleton width={96} height={18} radius={999} />
                </span>
                <span className={s.cDiff}>
                  <Skeleton width={46} height={18} radius={999} />
                </span>
                <span className={s.cAcc} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Skeleton width={40} height={12} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
