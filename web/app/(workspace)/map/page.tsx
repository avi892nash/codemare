import type { Metadata } from 'next';
import { HashScroll } from '@/components/Loop/HashScroll';
import { LoopPage } from '@/components/Loop/LoopPage';
import { requireViewer } from '@/components/Learn/viewer';
import { MapHero } from '@/components/Map/MapHero';
import { RunningAttemptBanner } from '@/components/Map/RunningAttemptBanner';
import { TierSection } from '@/components/Map/TierSection';
import type { BalanceIndex } from '@/components/Map/TopicActions';
import { ProblemList } from '@/components/Map/TopicProblems';
import s from '@/components/Map/map.module.css';
import { sceneSrc } from '@/components/TopicArt/TopicArt';
import { pickFeaturedTopic } from '@/lib/server/featuredTopic';
import { getMapView } from '@/lib/server/loopViews';

export const metadata: Metadata = { title: 'Tier map · Codemare' };
export const dynamic = 'force-dynamic';

/**
 * T1 — the tier map, and the home page: a hero featuring the topic to work
 * on next (animated art, its progress and one button), then every tier (open
 * or behind its gate), every topic with its picture, balance, recipes and
 * "what's blocking you", its problems (listed once it is unlocked), the
 * unlock flow and the gates. Reading it lazily finishes an expired gate attempt.
 */
export default async function MapPage() {
  const viewer = await requireViewer('/map');
  const view = await getMapView(viewer.id);
  const balances: BalanceIndex = Object.fromEntries(
    view.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, { title: topic.title, total: topic.balance.total }]))
  );
  const { totals } = view;
  // The first cards are the ones in view when the page opens — one on a phone, a row of two or three wider up: ask for
  // their scenes now, at low priority, so they are in hand by the time the page hydrates and <ArtInView> wants them
  // (the rest load as their cards come near). The media queries keep a phone from fetching what it will not show.
  const firstScenes = view.tiers
    .flatMap((tier) => tier.topics)
    .slice(0, 3)
    .map((t, i) => ({ href: sceneSrc(t.slug), media: [undefined, '(min-width: 720px)', '(min-width: 1100px)'][i] }));

  return (
    <LoopPage label="Tier map">
      {firstScenes.map(({ href, media }) => (
        <link key={href} rel="preload" as="fetch" href={href} media={media} crossOrigin="anonymous" fetchPriority="low" />
      ))}
      <MapHero featured={pickFeaturedTopic(view.tiers)} totals={totals} />
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
