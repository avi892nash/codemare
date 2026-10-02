import type { Metadata } from 'next';
import { HashScroll } from '@/components/Loop/HashScroll';
import { LoopHero, LoopPage } from '@/components/Loop/LoopPage';
import { requireViewer } from '@/components/Learn/viewer';
import { RunningAttemptBanner } from '@/components/Map/RunningAttemptBanner';
import { TierSection } from '@/components/Map/TierSection';
import type { BalanceIndex } from '@/components/Map/TopicActions';
import s from '@/components/Map/map.module.css';
import { getMapView } from '@/lib/server/loopViews';

export const metadata: Metadata = { title: 'Tier map · Codemare' };
export const dynamic = 'force-dynamic';

/**
 * T1 — the tier map: every tier (open or behind its gate), every topic with
 * its balance, recipes and "what's blocking you", the unlock flow and the
 * gates. Reading it lazily finishes an expired gate attempt.
 */
export default async function MapPage() {
  const viewer = await requireViewer('/map');
  const view = await getMapView(viewer.id);
  const balances: BalanceIndex = Object.fromEntries(
    view.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, { title: topic.title, total: topic.balance.total }]))
  );
  const { totals } = view;

  return (
    <LoopPage label="Tier map">
      <LoopHero
        icon="map"
        eyebrow="Tier map"
        title="Earn tokens, unlock topics, open tiers"
        subtitle="Accepted solves pay tokens in their topics. Spend any one recipe to unlock a topic, and pass a tier’s gate to open it."
        stats={[
          { label: 'Tokens', value: totals.tokens, testId: 'map-tokens' },
          { label: 'Topics unlocked', value: totals.topicsUnlocked, unit: `/ ${totals.topicsTotal}` },
          { label: 'Tiers open', value: totals.tiersOpen, unit: `/ ${totals.tiersTotal}` },
        ]}
      />
      {view.running && <RunningAttemptBanner running={view.running} />}
      <div className={s.tiers}>
        {view.tiers.map((tier) => (
          <TierSection key={tier.id} tier={tier} balances={balances} />
        ))}
      </div>
      <HashScroll />
    </LoopPage>
  );
}
