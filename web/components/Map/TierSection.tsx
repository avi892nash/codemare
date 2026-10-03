import { Icon } from '@/components/ui/Icon';
import type { TierView } from '@/lib/server/loopViews';
import { GateCard } from './GateCard';
import { StateLabel } from './StateLabel';
import type { BalanceIndex } from './TopicActions';
import { TopicCard } from './TopicCard';
import { TopicThumb } from './TopicThumb';
import s from './map.module.css';

function TierHeading({ tier, titleId }: { tier: TierView; titleId: string }) {
  return (
    <div className={s.tierHeading}>
      <span className={s.tierNum} aria-hidden="true">
        Tier {tier.ord}
      </span>
      <h2 className={s.tierTitle} id={titleId}>
        <span className="sr-only">Tier {tier.ord}: </span>
        {tier.title}
      </h2>
    </div>
  );
}

/**
 * One tier of the map. An open tier is shown in full: its header and every
 * topic as a row. A closed tier is ONE compact panel — its name, why it is
 * closed in a line, and its topics as a quiet row of posters and names — that
 * opens (a <details>: keyboard-operable, no script) to the gate that opens it
 * and its topics. The blocker is said once, here, instead of on every topic.
 * Either way the tier answers to `#tier-<slug>`, and a link to something
 * inside a closed panel opens it (components/Loop/HashScroll).
 */
export function TierSection({ tier, balances, openTopic }: { tier: TierView; balances: BalanceIndex; openTopic: string | null }) {
  const titleId = `tier-${tier.slug}-title`;

  if (tier.open) {
    return (
      <section className={s.tier} data-open="true" id={`tier-${tier.slug}`} aria-labelledby={titleId} data-testid={`tier-${tier.slug}`}>
        <header className={s.tierBar}>
          <TierHeading tier={tier} titleId={titleId} />
          <StateLabel kind="open" data-testid="tier-state" />
        </header>
        <ul className={s.topics} aria-label={`${tier.title} topics`}>
          {tier.topics.map((t) => (
            <li key={t.id}>
              <TopicCard topic={t} balances={balances} defaultOpen={t.slug === openTopic} />
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <details className={s.tier} data-open="false" id={`tier-${tier.slug}`} data-testid={`tier-${tier.slug}`}>
      <summary className={s.tierSummary}>
        <div className={s.tierBar}>
          <TierHeading tier={tier} titleId={titleId} />
          <div className={s.tierEnd}>
            <StateLabel kind="locked" data-testid="tier-state" />
            <span className={s.chev} aria-hidden="true">
              <Icon name="chev-down" size={16} />
            </span>
          </div>
        </div>
        <p className={s.tierReason}>{tier.gate ? `Opens after the ${tier.gate.title}` : 'Closed for now'}</p>
        <div className={s.tierPreview}>
          {tier.topics.map((t) => (
            <span key={t.id} className={s.previewItem}>
              <TopicThumb slug={t.slug} state={t.state} size="sm" />
              <span>{t.title}</span>
            </span>
          ))}
        </div>
      </summary>
      <div className={s.tierBody}>
        {tier.gate && <GateCard gate={tier.gate} tier={{ slug: tier.slug, title: tier.title }} />}
        <ul className={s.topics} aria-label={`${tier.title} topics`}>
          {tier.topics.map((t) => (
            <li key={t.id}>
              <TopicCard topic={t} balances={balances} inClosedTier />
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
