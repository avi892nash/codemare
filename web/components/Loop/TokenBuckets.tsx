import { Icon } from '@/components/ui/Icon';
import { DIFFICULTIES, type Difficulty } from '@/lib/types';
import s from './loop.module.css';

/**
 * A topic balance and its difficulty buckets (spec §3.1): the total, then
 * Easy · Medium · Hard. Recipes can require tokens from a minimum
 * difficulty, so the split matters. Server-safe.
 */
export function TokenBuckets({
  balance,
  label = 'Your tokens',
}: {
  balance: { total: number; byDifficulty: Record<Difficulty, number> };
  label?: string;
}) {
  return (
    <div className={s.buckets}>
      <span className={s.bucketTotal} title={label}>
        <Icon name="coin" size={13} />
        <span className="mono">{balance.total}</span>
        <span className="sr-only">{label.toLowerCase()}:</span>
      </span>
      <ul className={s.bucketList} aria-label={`${label} by difficulty`}>
        {DIFFICULTIES.map((d) => {
          const n = balance.byDifficulty[d] ?? 0;
          return (
            <li key={d} className={s.bucket} data-empty={n === 0 || undefined}>
              <span className={s.bucketDot} data-level={d} aria-hidden="true" />
              {d} <span className="mono">{n}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
