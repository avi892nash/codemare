import type { CSSProperties } from 'react';
import { ArtInView } from '@/components/TopicArt/ArtInView';
import { topicMeta } from '@/components/TopicArt/art';
import { TopicArt } from '@/components/TopicArt/TopicArt';
import { ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Progress } from '@/components/ui/Progress';
import type { Featured, FeaturedReason } from '@/lib/server/featuredTopic';
import type { MapView } from '@/lib/server/loopViews';
import s from './map.module.css';

/** The line above the title: why this topic is the one on show. */
const KICKER: Record<FeaturedReason, string> = {
  continue: 'Pick up where you left off',
  start: 'Up next',
  unlock: 'Ready to unlock',
  missing: 'Closest to unlocking',
  done: 'All clear',
};

/**
 * The tier map's header and hero — what the learner does now. One small h1
 * ("Tier map") with the three totals as chips beside it, then a banner that
 * features ONE topic as animated art (the learner's next up, chosen by
 * pickFeaturedTopic) with its name, caption, "n/m solved" and the page's one
 * primary action. The art is decoration: the title, caption and button carry
 * the meaning. On phones the art stacks above the text.
 */
export function MapHero({ featured, totals }: { featured: Featured | null; totals: MapView['totals'] }) {
  return (
    <header className={s.mapHead}>
      <div className={s.mapTop}>
        <h1 className={s.mapEyebrow}>
          <Icon name="map" size={13} /> Tier map
        </h1>
        <ul className={s.chips} aria-label="Your progress">
          <li className={s.chip}>
            <Icon name="coin" size={13} />
            <strong data-testid="map-tokens">{totals.tokens}</strong> <span>tokens</span>
          </li>
          <li className={s.chip}>
            <strong>
              {totals.topicsUnlocked}/{totals.topicsTotal}
            </strong>{' '}
            <span>
              topics<span className={s.chipMore}> unlocked</span>
            </span>
          </li>
          <li className={s.chip}>
            <strong>
              {totals.tiersOpen}/{totals.tiersTotal}
            </strong>{' '}
            <span>
              tiers<span className={s.chipMore}> open</span>
            </span>
          </li>
        </ul>
      </div>
      {featured && <FeaturedBanner featured={featured} />}
    </header>
  );
}

function FeaturedBanner({ featured }: { featured: Featured }) {
  const { topic, reason } = featured;
  const meta = topicMeta(topic.slug);
  const done = reason === 'done';
  const title = done ? 'Every topic cleared' : topic.title;
  const caption = done ? 'Every topic is open and every problem solved. Nicely done.' : meta.caption;
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
        {!done && topic.total > 0 && (
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
        <ButtonLink href={featured.cta.href} variant="primary" size="lg" iconRight="arrow-right" className={s.featureCta} data-testid="map-hero-cta">
          {featured.cta.label}
        </ButtonLink>
      </div>
    </section>
  );
}
