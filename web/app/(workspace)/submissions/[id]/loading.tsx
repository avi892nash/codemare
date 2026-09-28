import { Skeleton, SkeletonText } from '@/components/ui/Skeleton';
import s from '@/components/Submissions/Submissions.module.css';

/** Placeholder shaped like the submission detail: header, hero, code. */
export default function SubmissionLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={s.main}>
      <span className="sr-only">Loading submission…</span>
      <div className={s.page} aria-hidden="true">
        <Skeleton width={180} height={12} style={{ marginBottom: 18 }} />
        <div className={s.detailHead}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
            <Skeleton width={120} height={10} />
            <Skeleton width="min(320px, 70%)" height={26} radius={6} />
            <div style={{ display: 'flex', gap: 8 }}>
              <Skeleton width={96} height={22} radius={999} />
              <Skeleton width={120} height={14} />
            </div>
          </div>
          <Skeleton width={132} height={32} radius={6} />
        </div>
        <div className={s.hero}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton width={140} height={10} />
            <Skeleton width={200} height={56} radius={8} />
            <Skeleton width={240} height={5} />
          </div>
          <div className={s.heroSide}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Skeleton width={70} height={9} />
                <Skeleton width={90} height={20} />
              </div>
            ))}
          </div>
        </div>
        <Skeleton width={80} height={14} style={{ margin: '26px 0 10px' }} />
        <div className="card-2" style={{ padding: 16 }}>
          <SkeletonText lines={8} />
        </div>
      </div>
    </div>
  );
}
