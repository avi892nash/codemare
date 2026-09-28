import { Pill } from '@/components/ui/Pill';
import type { TierView } from '@/lib/server/loopViews';
import { GateCard } from './GateCard';
import type { BalanceIndex } from './TopicActions';
import { TopicCard } from './TopicCard';
import s from './map.module.css';

/** One tier of the map: its header, the gate that opens it, and its topics. */
export function TierSection({ tier, balances }: { tier: TierView; balances: BalanceIndex }) {
  const titleId = `tier-${tier.slug}-title`;
  return (
    <section className={s.tier} data-open={tier.open} id={`tier-${tier.slug}`} aria-labelledby={titleId} data-testid={`tier-${tier.slug}`}>
      <header className={s.tierHead}>
        <span className={s.tierBadge} aria-hidden="true">
          <small>Tier</small>
          <strong className="mono">{tier.ord}</strong>
        </span>
        <div className={s.tierTitleRow}>
          <h2 className={s.tierTitle} id={titleId}>
            <span className="sr-only">Tier {tier.ord}: </span>
            {tier.title}
          </h2>
          {tier.ord === 0 ? (
            <Pill tone="ok" size="xs" icon="check">
              Always open
            </Pill>
          ) : tier.open ? (
            <Pill tone="ok" size="xs" icon="lock-open" data-testid="tier-state">
              Open
            </Pill>
          ) : (
            <Pill tone="muted" size="xs" icon="lock" data-testid="tier-state">
              Closed
            </Pill>
          )}
        </div>
        <p className={s.tierSummary}>{tier.summary}</p>
      </header>
      {tier.gate && <GateCard gate={tier.gate} tier={{ slug: tier.slug, title: tier.title }} />}
      <ul className={s.topics} aria-label={`${tier.title} topics`}>
        {tier.topics.map((t) => (
          <li key={t.id}>
            <TopicCard topic={t} free={tier.ord === 0} balances={balances} />
          </li>
        ))}
      </ul>
    </section>
  );
}
