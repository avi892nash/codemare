import type { Metadata } from 'next';
import { HashScroll } from '@/components/Loop/HashScroll';
import { LoopHero, LoopPage } from '@/components/Loop/LoopPage';
import { requireViewer } from '@/components/Learn/viewer';
import { RunningAttemptBanner } from '@/components/Map/RunningAttemptBanner';
import { TierSection } from '@/components/Map/TierSection';
import type { BalanceIndex } from '@/components/Map/TopicActions';
import { ProblemList } from '@/components/Map/TopicProblems';
import s from '@/components/Map/map.module.css';
import { getMapView } from '@/lib/server/loopViews';

export const metadata: Metadata = { title: 'Tier map · Codemare' };
export const dynamic = 'force-dynamic';

/**
 * T1 — the tier map, and the home page: every tier (open or behind its
 * gate), every topic with its balance, recipes and "what's blocking you",
 * its problems (listed once it is unlocked), the unlock flow and the gates.
 * Reading it lazily finishes an expired gate attempt.
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
        subtitle="Every unlocked topic lists its problems below, and accepted solves pay tokens in their topics. Spend any one recipe to unlock a topic, and pass a tier’s gate to open it."
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
        {view.unfiled.length > 0 && (
          <section className={s.tier} aria-labelledby="unfiled-title" data-testid="unfiled-problems">
            <header className={s.unfiledHead}>
              <h2 className={s.tierTitle} id="unfiled-title">
                Other problems
              </h2>
              <p className={s.tierSummary}>Problems that aren’t filed under a topic yet. They open for everyone and pay no tokens.</p>
            </header>
            <ProblemList problems={view.unfiled} label="Other problems" />
          </section>
        )}
      </div>
      <HashScroll />
    </LoopPage>
  );
}
