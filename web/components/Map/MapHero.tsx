import type { CSSProperties } from 'react';
import { ArtInView } from '@/components/TopicArt/ArtInView';
import { topicMeta } from '@/components/TopicArt/art';
import { TopicArt } from '@/components/TopicArt/TopicArt';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PageHeader } from '@/components/ui/PageHeader';
import { Progress } from '@/components/ui/Progress';
import type { Featured, FeaturedReason } from '@/lib/server/featuredTopic';
import type { Milestone } from '@/lib/server/mapMilestone';
import type { MapView } from '@/lib/server/loopViews';
import { HowItWorksToggle } from './HowItWorks';
import s from './map.module.css';

/** The line above the title: why this is the one on show. */
const KICKER: Record<FeaturedReason, string> = {
  continue: 'Pick up where you left off',
  start: 'Up next',
  unlock: 'Ready to unlock',
  gate: 'Ready for the gate',
  missing: 'Closest to unlocking',
  done: 'All clear',
};

/**
 * The tier map's header: the page's title and, under it, ONE quiet line of
 * progress — problems solved, topics unlocked, tiers open (the token total is
 * in the top bar, once) — ending in the link that brings the first-run card
 * back. The shared PageHeader, like every page's.
 */
export function MapHeader({ totals }: { totals: MapView['totals'] }) {
  return (
    <PageHeader
      title="Tier map"
      subtitle={
        <>
          <span className={s.progressLine} data-testid="map-progress">
            <span className={s.nowrap}>
              {totals.solved}/{totals.problems} problems solved
            </span>{' '}
            <span className={s.dot} aria-hidden="true">
              ·
            </span>{' '}
            <span className={s.nowrap}>
              {totals.topicsUnlocked}/{totals.topicsTotal} topics unlocked
            </span>{' '}
            <span className={s.dot} aria-hidden="true">
              ·
            </span>{' '}
            <span className={s.nowrap}>
              {totals.tiersOpen}/{totals.tiersTotal} tiers open
            </span>
          </span>{' '}
          <HowItWorksToggle />
        </>
      }
    />
  );
}

/**
 * The hero, and — only when there is one — a single milestone line under it.
 * The hero is a banner that features ONE thing as animated art: the learner's
 * next-up topic (chosen by pickFeaturedTopic) with its name, caption, "n/m
 * solved" and the page's one primary action — or, once there is nothing left
 * to solve in what is open and a gate can be taken, that gate. The art is
 * decoration: the title, caption and button carry the meaning. On phones the
 * art stacks above the text.
 */
export function MapHero({ featured, milestone, gateRunning = false }: { featured: Featured | null; milestone: Milestone | null; gateRunning?: boolean }) {
  return (
    <>
      {featured && <FeaturedBanner featured={featured} quiet={gateRunning} />}
      {milestone && <MilestoneLine milestone={milestone} />}
    </>
  );
}

/** `quiet`: a gate attempt is running, and the banner under the hero owns the page's one primary action (the clock is ticking). */
function FeaturedBanner({ featured, quiet }: { featured: Featured; quiet: boolean }) {
  const { topic, reason, gate } = featured;
  const meta = topicMeta(topic.slug);
  const done = reason === 'done';
  const title = done ? 'Every topic cleared' : gate ? gate.title : topic.title;
  const caption = done
    ? 'Every topic is open and every problem solved. Nicely done.'
    : gate
      ? `A timed set of ${gate.questionCount} problems: solve ${gate.passThreshold} in ${gate.timeLimitMinutes} minutes to open ${gate.tierTitle}.`
      : meta.caption;
  return (
    <section className={s.feature} aria-labelledby="map-feature-title" data-testid="map-hero" data-reason={reason} data-topic={topic.slug} style={{ '--a': meta.hue } as CSSProperties}>
      <ArtInView className={s.featureArt}>
        <TopicArt slug={topic.slug} />
      </ArtInView>
      <div className={s.featureBody}>
        <p className={s.kicker}>{KICKER[reason]}</p>
        <h2 className={s.featureTitle} id="map-feature-title" data-testid="map-hero-title">
          {title}
        </h2>
        {caption && <p className={s.featureCaption}>{caption}</p>}
        {!done && !gate && topic.total > 0 && (
          <div className={s.featureProgress} data-testid="map-hero-progress">
            <span className={s.featureCount}>
              <span className="mono">
                {topic.solved}/{topic.total}
              </span>{' '}
              solved
            </span>
            <Progress value={topic.solved} max={topic.total} tone="ok" height={4} />
          </div>
        )}
        <ButtonLink href={featured.cta.href} id="map-hero-cta" variant={quiet ? 'default' : 'primary'} size="lg" iconRight="arrow-right" className={s.featureCta} data-testid="map-hero-cta">
          {featured.cta.label}
        </ButtonLink>
      </div>
    </section>
  );
}

/** One line under the hero, for the moment worth a nudge — never a second hero, and it asks nothing of the learner. */
function MilestoneLine({ milestone }: { milestone: Milestone }) {
  return (
    <p className={s.milestone} data-testid="map-milestone" data-kind={milestone.kind}>
      <Icon name={milestone.kind === 'unlock' ? 'sparkle' : 'shield'} size={16} />
      <span className={s.milestoneText}>
        {milestone.lead}
        <strong>{milestone.subject}</strong>
        {milestone.text}
      </span>
      <ButtonLink href={milestone.cta.href} size="sm" variant="default" data-testid="map-milestone-cta">
        {milestone.cta.label}
        {milestone.cta.sr && <span className="sr-only">{milestone.cta.sr}</span>}
      </ButtonLink>
    </p>
  );
}
