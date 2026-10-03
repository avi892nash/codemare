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
 *  2. else a GATE the learner can take now (the tier before it is open, no
 *     attempt is running, no cooldown) and is ready for — they have already
 *     solved as many of its problems as it takes to pass (the pass threshold,
 *     3 of 4 for the seeded gates): "You can take the <gate> now — 3 of its 4
 *     problems solved", linking to its card. Nothing is said before that: a
 *     learner who has met one of its problems is not yet near it, and "gate"
 *     is not a word to spring on someone at their first solve. A running
 *     attempt has its banner, and a gate the hero already offers is not said
 *     twice;
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
    /** How many of the gate's problems the learner has solved at all (an accepted submit anywhere, not only in an attempt). */
    solvedCount: number;
    /** How many it takes to pass, and how many it has. */
    passThreshold: number;
    questionCount: number;
  } | null;
  topics: readonly MilestoneTopicInput[];
}

export type MilestoneKind = 'unlock' | 'gate';

export interface Milestone {
  kind: MilestoneKind;
  /** The sentence, in three parts so that the name can be bold: before · name · after. */
  lead: string;
  subject: string;
  text: string;
  /** The one action; both go to a card on the map. `sr` is read after the label, for the context a sighted learner has. */
  cta: { label: string; href: string; sr?: string };
}

/** The milestone for `tiers` (in curriculum order), given what the hero features, or null when there is none. */
export function pickMilestone(
  tiers: readonly MilestoneTierInput[],
  featured: { reason: Featured['reason']; topic: { slug: string }; gate?: { id: string } | null } | null
): Milestone | null {
  const heroUnlock = featured?.reason === 'unlock' ? featured.topic.slug : null;
  const heroGate = featured?.reason === 'gate' ? featured.gate?.id ?? null : null;
  for (const tier of tiers) {
    for (const topic of tier.topics) {
      if (topic.state !== 'unlockable' || topic.slug === heroUnlock) continue;
      return { kind: 'unlock', lead: '', subject: topic.title, text: ' is ready to unlock', cta: { label: 'Unlock', href: `#topic-${topic.slug}`, sr: ` ${topic.title}` } };
    }
  }
  for (const tier of tiers) {
    const gate = tier.gate;
    if (!gate || gate.state !== 'eligible' || gate.id === heroGate || gate.solvedCount < gate.passThreshold) continue;
    return {
      kind: 'gate',
      lead: 'You can take the ',
      subject: gate.title,
      text: ` now — ${gate.solvedCount} of its ${gate.questionCount} problems solved`,
      cta: { label: 'Take the gate', href: `#gate-${gate.id}` },
    };
  }
  return null;
}
