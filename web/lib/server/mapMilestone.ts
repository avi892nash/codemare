import type { Featured } from './featuredTopic';

/**
 * The tier map's "next milestone": ONE quiet line under the hero for the
 * moment worth a nudge, so a learner who is busy solving problems does not
 * miss it. Pure — it reads the view /map already builds (getMapView), in
 * curriculum order, and adds no restriction of any kind; the hero and its
 * button are not touched. In order:
 *
 *  1. a topic that is ready to UNLOCK (its tier is open and a recipe is
 *     affordable) — "<Topic> is ready to unlock", linking to its card. The
 *     topic the hero already features for that reason is left out (the hero
 *     says it), so a second ready topic still gets its line;
 *  2. else a GATE that is open to the learner (the tier before it is open,
 *     no attempt is running, no cooldown) and of whose problems they have
 *     already solved at least one — "<Gate> is open", linking to its card.
 *     A learner who has solved none of them is not nudged: a gate at zero
 *     solved is not a milestone, and a running attempt has its banner;
 *  3. else nothing.
 */

/** What this needs from a topic card (TopicCardView has all of it). */
export interface MilestoneTopicInput {
  slug: string;
  title: string;
  state: 'unlocked' | 'unlockable' | 'needs_tokens' | 'tier_closed' | 'no_recipe';
}

/** What this needs from a tier (TierView has all of it). */
export interface MilestoneTierInput {
  slug: string;
  title: string;
  gate: {
    id: string;
    title: string;
    state: 'passed' | 'eligible' | 'running' | 'cooldown' | 'previous_tier_closed';
    /** How many of the gate's problems the learner has solved at all. */
    solvedCount: number;
  } | null;
  topics: readonly MilestoneTopicInput[];
}

export type MilestoneKind = 'unlock' | 'gate';

export interface Milestone {
  kind: MilestoneKind;
  /** The topic's or gate's name: bold at the start of the line. */
  subject: string;
  /** The rest of the sentence ("is ready to unlock"). */
  text: string;
  /** The one action; both go to a card on the map. */
  cta: { label: string; href: string };
}

/** The milestone for `tiers` (in curriculum order), given what the hero features, or null when there is none. */
export function pickMilestone(
  tiers: readonly MilestoneTierInput[],
  featured: { reason: Featured['reason']; topic: { slug: string } } | null
): Milestone | null {
  const heroUnlock = featured?.reason === 'unlock' ? featured.topic.slug : null;
  for (const tier of tiers) {
    for (const topic of tier.topics) {
      if (topic.state !== 'unlockable' || topic.slug === heroUnlock) continue;
      return { kind: 'unlock', subject: topic.title, text: 'is ready to unlock', cta: { label: 'Unlock', href: `#topic-${topic.slug}` } };
    }
  }
  for (const tier of tiers) {
    const gate = tier.gate;
    if (!gate || gate.state !== 'eligible' || gate.solvedCount < 1) continue;
    return { kind: 'gate', subject: gate.title, text: 'is open', cta: { label: 'View', href: `#gate-${gate.id}` } };
  }
  return null;
}
