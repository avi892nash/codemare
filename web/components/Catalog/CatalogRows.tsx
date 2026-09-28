import Link from 'next/link';
import { DifficultyPill } from '@/components/ui/DifficultyPill';
import { Icon } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Pill';
import { StatusDot } from '@/components/ui/StatusDot';
import type { CatalogRow } from '@/lib/server/catalog';
import s from './Catalog.module.css';

const STATUS_TEXT = { solved: 'Solved', attempted: 'Attempted', todo: 'Not started' } as const;

/**
 * How many topic pills fit the column: two short ones, else one plus a "+N"
 * (whose title and screen-reader text name the rest) instead of a clipped pill.
 */
function shownTopics(topics: CatalogRow['topics']): number {
  if (topics.length < 2) return topics.length;
  return topics[0].title.length + topics[1].title.length <= 26 ? 2 : 1;
}

/** Column titles, aligned with the row grid (visual only: rows carry their own labels). */
export function CatalogColumnHead() {
  return (
    <div className={s.colHead} aria-hidden="true">
      <span style={{ gridArea: 'status' }} />
      <span style={{ gridArea: 'title' }}>Title</span>
      <span className={s.cTopics}>Topics</span>
      <span style={{ gridArea: 'diff' }}>Difficulty</span>
      <span className={s.cAcc}>Acceptance</span>
    </div>
  );
}

/**
 * One link per question. Accessible questions open the editor; locked ones
 * (topics not unlocked yet) still list, with a lock, and open the tier map.
 * Server component.
 */
export function CatalogRows({ rows }: { rows: CatalogRow[] }) {
  return (
    <ol className={s.rows} aria-label="Problems">
      {rows.map((r) => {
        const locked = !r.accessible;
        const shown = shownTopics(r.topics);
        const more = r.topics.slice(shown).map((t) => t.title).join(', ');
        return (
          <li key={r.id}>
            <Link
              href={locked ? '/map' : `/problems/${r.slug}`}
              className={s.row}
              data-locked={locked || undefined}
              data-slug={r.slug}
              title={locked ? `${r.title} is locked. Unlock its topics on the map.` : undefined}
            >
              <span className={s.cStatus}>
                <StatusDot status={r.status === 'todo' ? 'unsolved' : r.status} />
                <span className="sr-only">{STATUS_TEXT[r.status]}:</span>
              </span>
              <span className={s.cTitle}>
                <span className={s.titleText}>{r.title}</span>
                {locked && (
                  <>
                    <Icon name="lock" size={12} className={s.lock} />
                    <span className="sr-only">(locked, opens the tier map)</span>
                  </>
                )}
              </span>
              <span className={s.cTopics}>
                {r.topics.slice(0, shown).map((t) => (
                  <Pill key={t.slug} tone="muted" size="xs" icon={t.icon}>
                    {t.title}
                  </Pill>
                ))}
                {r.topics.length > shown && (
                  <Pill tone="muted" size="xs" title={more}>
                    +{r.topics.length - shown}
                    <span className="sr-only"> more: {more}</span>
                  </Pill>
                )}
              </span>
              <span className={s.cDiff}>
                <DifficultyPill level={r.difficulty} size="xs" />
              </span>
              <span className={`${s.cAcc} mono`} data-empty={r.acceptance === null || undefined}>
                {r.acceptance === null ? (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">No submissions yet</span>
                  </>
                ) : (
                  <>
                    {r.acceptance.toFixed(1)}%<span className={s.accWord}> acceptance</span>
                  </>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
