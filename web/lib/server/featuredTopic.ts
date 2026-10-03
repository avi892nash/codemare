import type { Difficulty } from '@/lib/types';
import type { ProblemProgress } from './topicProblems';

/**
 * Which topic the tier map's hero features, and what its one button does:
 * the learner's "what do I do now?" now that the problem list is gone. Pure
 * — it reads the view /map already builds (getMapView), in curriculum order,
 * and decides:
 *
 *  1. the first UNLOCKED topic that still has an unsolved problem that opens
 *     for them: its first attempted-but-unsolved problem ("Continue: …"),
 *     else its first untouched one ("Start: …"), linking to the editor;
 *  2. else the first topic that is ready to UNLOCK ("Unlock …", its card);
 *  3. else the first GATE that can be taken now (its tier is closed, the tier
 *     before it is open, no attempt is running and no cooldown) — the learner
 *     has nothing left to solve in what is open, and the gate is the way on:
 *     "Take the <gate>", linking to the gate's card. The art is that of the
 *     first topic the gate opens;
 *  4. else the topic closest to unlocking — fewest tokens missing from its
 *     cheapest recipe, an open tier before a closed one — ("See what’s
 *     missing", its card);
 *  5. else every topic is open and solved: a congratulation on the last one.
 *
 * "Opens for them" is the view's own flag: a problem whose `needs` is empty
 * (every topic unlocked, or part of a running gate attempt — questionAccessMap),
 * so a composite that a locked topic still keeps closed is never offered.
 *
 * The gate is offered, never required: nothing here restricts anything, and
 * the gate stays where it was, in its tier's panel, whatever the hero says.
 */

/** What this needs from a topic card (TopicCardView has all of it). */
export interface FeaturedTopicInput {
  slug: string;
  title: string;
  state: 'unlocked' | 'unlockable' | 'needs_tokens' | 'tier_closed' | 'no_recipe';
  recipes: readonly { missing: number }[];
  problems: {
    total: number;
    solved: number;
    list: readonly { slug: string; title: string; difficulty: Difficulty; progress: ProblemProgress; needs: readonly unknown[] }[];
  };
}

/** What this needs from a tier (TierView has all of it). */
export interface FeaturedTierInput {
  title?: string;
  /** The gate that opens this tier, when it has one. */
  gate?: {
    id: string;
    title: string;
    state: 'passed' | 'eligible' | 'running' | 'cooldown' | 'previous_tier_closed';
    passThreshold: number;
    questionCount: number;
    timeLimitMinutes: number;
  } | null;
  topics: readonly FeaturedTopicInput[];
}

export type FeaturedReason = 'continue' | 'start' | 'unlock' | 'gate' | 'missing' | 'done';

export interface Featured {
  reason: FeaturedReason;
  /** The topic whose art the hero shows (and, except for "gate", whose name it carries). */
  topic: { slug: string; title: string; solved: number; total: number };
  /** The problem the button opens ("continue" and "start"); otherwise null. */
  problem: { slug: string; title: string; difficulty: Difficulty } | null;
  /** "missing": the tokens the cheapest recipe still lacks; otherwise null. */
  missing: number | null;
  /** "gate": the gate on offer and what it asks; otherwise null. */
  gate: { id: string; title: string; tierTitle: string; passThreshold: number; questionCount: number; timeLimitMinutes: number } | null;
  cta: { label: string; href: string };
}

const topicRef = (t: FeaturedTopicInput) => ({ slug: t.slug, title: t.title, solved: t.problems.solved, total: t.problems.total });
const cardHref = (t: FeaturedTopicInput) => `#topic-${t.slug}`;

/** Tokens the cheapest recipe still lacks (Infinity without a recipe). */
function tokensMissing(t: FeaturedTopicInput): number {
  return t.recipes.reduce((least, r) => Math.min(least, r.missing), Infinity);
}

/** Open tier first when the same tokens are missing: `needs_tokens` is the only state that is not blocked by something else. */
const BLOCK_RANK: Record<FeaturedTopicInput['state'], number> = { unlocked: 0, unlockable: 0, needs_tokens: 0, tier_closed: 1, no_recipe: 2 };

/** The featured topic of `tiers` (in curriculum order), or null when there is no topic at all. */
export function pickFeaturedTopic(tiers: readonly FeaturedTierInput[]): Featured | null {
  const topics = tiers.flatMap((t) => t.topics);
  if (topics.length === 0) return null;

  for (const topic of topics) {
    if (topic.state !== 'unlocked') continue;
    const open = topic.problems.list.filter((p) => p.progress !== 'solved' && p.needs.length === 0);
    const next = open.find((p) => p.progress === 'attempted') ?? open[0];
    if (!next) continue;
    const reason = next.progress === 'attempted' ? 'continue' : 'start';
    return {
      reason,
      topic: topicRef(topic),
      problem: { slug: next.slug, title: next.title, difficulty: next.difficulty },
      missing: null,
      gate: null,
      cta: { label: `${reason === 'continue' ? 'Continue' : 'Start'}: ${next.title}`, href: `/problems/${next.slug}` },
    };
  }

  const unlockable = topics.find((t) => t.state === 'unlockable');
  if (unlockable) {
    return { reason: 'unlock', topic: topicRef(unlockable), problem: null, missing: null, gate: null, cta: { label: `Unlock ${unlockable.title}`, href: cardHref(unlockable) } };
  }

  for (const tier of tiers) {
    const gate = tier.gate;
    const first = tier.topics[0];
    if (!gate || gate.state !== 'eligible' || !first) continue;
    return {
      reason: 'gate',
      topic: topicRef(first),
      problem: null,
      missing: null,
      gate: {
        id: gate.id,
        title: gate.title,
        tierTitle: tier.title ?? 'the next tier',
        passThreshold: gate.passThreshold,
        questionCount: gate.questionCount,
        timeLimitMinutes: gate.timeLimitMinutes,
      },
      cta: { label: `Take the ${gate.title}`, href: `#gate-${gate.id}` },
    };
  }

  const blocked = topics
    .map((t, i) => ({ t, i, missing: tokensMissing(t) }))
    .filter(({ t }) => t.state !== 'unlocked')
    .sort((a, b) => a.missing - b.missing || BLOCK_RANK[a.t.state] - BLOCK_RANK[b.t.state] || a.i - b.i)[0];
  if (blocked) {
    return {
      reason: 'missing',
      topic: topicRef(blocked.t),
      problem: null,
      missing: Number.isFinite(blocked.missing) ? blocked.missing : null,
      gate: null,
      cta: { label: 'See what’s missing', href: cardHref(blocked.t) },
    };
  }

  const last = topics[topics.length - 1];
  return { reason: 'done', topic: topicRef(last), problem: null, missing: null, gate: null, cta: { label: 'See your submissions', href: '/submissions' } };
}
