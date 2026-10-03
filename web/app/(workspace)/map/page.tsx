import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { HashScroll } from '@/components/Loop/HashScroll';
import { LoopPage } from '@/components/Loop/LoopPage';
import { requireViewer } from '@/components/Learn/viewer';
import { FIRST_RUN_COOKIE } from '@/components/Map/firstRunCookie';
import { HowItWorks, HowItWorksCard } from '@/components/Map/HowItWorks';
import { MapHeader, MapHero } from '@/components/Map/MapHero';
import { MapMemory } from '@/components/Map/MapMemory';
import { RunningAttemptBanner } from '@/components/Map/RunningAttemptBanner';
import { TierSection } from '@/components/Map/TierSection';
import type { BalanceIndex } from '@/components/Map/TopicActions';
import { ProblemList } from '@/components/Map/TopicProblems';
import s from '@/components/Map/map.module.css';
import { sceneSrc } from '@/components/TopicArt/TopicArt';
import { pickFeaturedTopic } from '@/lib/server/featuredTopic';
import { getMapView } from '@/lib/server/loopViews';
import { pickMilestone } from '@/lib/server/mapMilestone';

export const metadata: Metadata = { title: 'Tier map · Codemare' };
export const dynamic = 'force-dynamic';

/**
 * T1 — the tier map, and the home page: the shared page header with one line
 * of progress, a hero featuring what to do next (a topic's animated art, its
 * progress and one button — or the gate, once there is nothing left to solve)
 * and, only when there is one, a single milestone line under it; the "How it
 * works" card while nothing is solved (and whenever the learner asks for it);
 * then every tier — the open ones in full, each closed one as a compact panel
 * with the gate that opens it — and every topic as a row that opens to its
 * problems (listed once it is unlocked), or to what is blocking it. Reading it
 * lazily finishes an expired gate attempt.
 */
export default async function MapPage() {
  const viewer = await requireViewer('/map');
  const [view, jar] = await Promise.all([getMapView(viewer.id), cookies()]);
  const balances: BalanceIndex = Object.fromEntries(
    view.tiers.flatMap((t) => t.topics.map((topic) => [topic.id, { title: topic.title, total: topic.balance.total }]))
  );
  const { totals } = view;
  const featured = pickFeaturedTopic(view.tiers);
  const milestone = pickMilestone(view.tiers, featured);
  const firstRun = totals.solved === 0 && jar.get(FIRST_RUN_COOKIE)?.value !== 'hide';
  // The rows that open with the page: past the first problem, the topic the hero is about, and the topic of the problem the
  // learner touched last; everything else is one row. (The rows they open themselves are kept by <MapMemory>.)
  const openTopics = new Set<string>();
  if (featured && (featured.reason === 'start' || featured.reason === 'continue') && totals.solved > 0) openTopics.add(featured.topic.slug);
  if (view.lastTouchedTopic) openTopics.add(view.lastTouchedTopic);
  // The first rows are the ones in view when the page opens — one on a phone (the hero and the steps come first), three
  // wider up: ask for their scenes now, at low priority, so they are in hand by the time the page hydrates and <ArtInView>
  // wants them (the rest load as their rows come near). The media queries keep a phone from fetching what it will not show.
  const firstScenes = view.tiers
    .flatMap((tier) => tier.topics)
    .slice(0, 3)
    .map((t, i) => ({ href: sceneSrc(t.slug), media: i === 0 ? undefined : '(min-width: 720px)' }));

  return (
    <LoopPage label="Tier map">
      {firstScenes.map(({ href, media }) => (
        <link key={href} rel="preload" as="fetch" href={href} media={media} crossOrigin="anonymous" fetchPriority="low" />
      ))}
      <HowItWorks initialOpen={firstRun}>
        <div className={s.mapHead}>
          <MapHeader totals={totals} />
          <MapHero featured={featured} milestone={milestone} />
        </div>
        {view.running && <RunningAttemptBanner running={view.running} />}
        <HowItWorksCard />
      </HowItWorks>
      <div className={s.tiers}>
        {view.tiers.map((tier) => (
          <TierSection key={tier.id} tier={tier} balances={balances} openTopics={openTopics} />
        ))}
        {view.unfiled.length > 0 && (
          <section className={s.tier} aria-labelledby="unfiled-title" data-testid="unfiled-problems">
            <header className={s.tierBar}>
              <div className={s.tierHeading}>
                <h2 className={s.tierTitle} id="unfiled-title">
                  Other problems
                </h2>
              </div>
            </header>
            <p className={s.unfiledNote}>Problems that aren’t filed under a topic yet. They open for everyone and pay no tokens.</p>
            <div className={s.unfiledList}>
              <ProblemList problems={view.unfiled} label="Other problems" />
            </div>
          </section>
        )}
      </div>
      <MapMemory />
      <HashScroll />
    </LoopPage>
  );
}
