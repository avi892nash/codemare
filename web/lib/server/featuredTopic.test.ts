import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@/lib/types';
import { pickFeaturedTopic, type FeaturedTierInput, type FeaturedTopicInput } from './featuredTopic';
import type { ProblemProgress } from './topicProblems';

type Problem = FeaturedTopicInput['problems']['list'][number];

/** A problem; `progress` and `needs` (the locked topics that keep it closed) are what the rule looks at. */
function problem(slug: string, progress: ProblemProgress = 'todo', needs: unknown[] = [], difficulty: Difficulty = 'Easy'): Problem {
  return { slug, title: slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()), difficulty, progress, needs };
}

/** An unlocked topic holding `list`; solved/total follow the list. */
function unlocked(slug: string, list: Problem[]): FeaturedTopicInput {
  return {
    slug,
    title: slug.toUpperCase(),
    state: 'unlocked',
    recipes: [],
    problems: { total: list.length, solved: list.filter((p) => p.progress === 'solved').length, list },
  };
}

/** A topic that is not unlocked yet: the learner can't list its problems, only count them. */
function locked(slug: string, state: Exclude<FeaturedTopicInput['state'], 'unlocked'>, missing: number[] = [], total = 5): FeaturedTopicInput {
  return { slug, title: slug.toUpperCase(), state, recipes: missing.map((m) => ({ missing: m })), problems: { total, solved: 0, list: [] } };
}

const tiers = (...topics: FeaturedTopicInput[][]) => topics.map((t) => ({ topics: t }));

type Gate = NonNullable<FeaturedTierInput['gate']>;
const gate = (id: string, state: Gate['state'] = 'eligible'): Gate => ({ id, title: `Gate ${id}`, state, passThreshold: 3, questionCount: 4, timeLimitMinutes: 45 });
/** A tier with the gate that opens it. */
const tier = (title: string, topics: FeaturedTopicInput[], g: Gate | null = null): FeaturedTierInput => ({ title, gate: g, topics });

describe('pickFeaturedTopic: a topic with something to solve', () => {
  it('starts a fresh learner on the first problem of the first topic', () => {
    const f = pickFeaturedTopic(tiers([unlocked('arrays', [problem('contains-duplicate'), problem('two-sum')]), unlocked('stack', [problem('valid-parentheses')])], [locked('search', 'tier_closed', [0])]));
    expect(f).toEqual({
      reason: 'start',
      topic: { slug: 'arrays', title: 'ARRAYS', solved: 0, total: 2 },
      problem: { slug: 'contains-duplicate', title: 'Contains duplicate', difficulty: 'Easy' },
      missing: null,
      gate: null,
      cta: { label: 'Start: Contains duplicate', href: '/problems/contains-duplicate' },
    });
  });

  it('continues an attempted problem before starting a fresh one, wherever it sits in the topic', () => {
    const f = pickFeaturedTopic(tiers([unlocked('arrays', [problem('a', 'solved'), problem('b'), problem('c', 'attempted'), problem('d', 'attempted')])]));
    expect(f).toMatchObject({ reason: 'continue', problem: { slug: 'c' }, cta: { label: 'Continue: C', href: '/problems/c' }, topic: { solved: 1, total: 4 } });
  });

  it('keeps to the first topic in curriculum order that has anything left, not the one most recently touched', () => {
    const f = pickFeaturedTopic(tiers([unlocked('arrays', [problem('a')]), unlocked('stack', [problem('s', 'attempted')])]));
    expect(f).toMatchObject({ reason: 'start', topic: { slug: 'arrays' }, problem: { slug: 'a' } });
  });

  it('moves on when a topic is finished, across tiers', () => {
    const f = pickFeaturedTopic(
      tiers(
        [unlocked('arrays', [problem('a', 'solved'), problem('b', 'solved')]), unlocked('stack', [problem('s', 'solved')])],
        [unlocked('search', [problem('x', 'solved'), problem('y', 'attempted')]), locked('window', 'unlockable', [0])],
      ),
    );
    expect(f).toMatchObject({ reason: 'continue', topic: { slug: 'search', solved: 1, total: 2 }, problem: { slug: 'y' } });
  });

  it('never offers a problem that a locked topic still keeps closed', () => {
    const closed = problem('three-sum', 'todo', [{ slug: 'sorting' }]);
    const f = pickFeaturedTopic(tiers([unlocked('pointers', [problem('reverse-string', 'solved'), closed]), unlocked('stack', [problem('valid-parentheses')])]));
    expect(f).toMatchObject({ reason: 'start', topic: { slug: 'stack' }, problem: { slug: 'valid-parentheses' } });
  });

  it('offers a problem that opens through a running gate attempt (the view lists it with nothing missing)', () => {
    // A composite of an unlocked topic and a locked one: the gate attempt opens it, so `needs` is empty.
    const gated = problem('three-sum', 'todo', []);
    const f = pickFeaturedTopic(tiers([unlocked('pointers', [problem('reverse-string', 'solved'), gated])]));
    expect(f).toMatchObject({ reason: 'start', problem: { slug: 'three-sum' } });
  });
});

describe('pickFeaturedTopic: nothing left to solve', () => {
  const solved = (slug: string) => unlocked(slug, [problem(`${slug}-1`, 'solved'), problem(`${slug}-2`, 'solved')]);

  it('features the first topic that is ready to unlock', () => {
    const f = pickFeaturedTopic(tiers([solved('arrays')], [locked('search', 'needs_tokens', [2]), locked('window', 'unlockable', [0]), locked('recursion', 'unlockable', [0])]));
    expect(f).toEqual({
      reason: 'unlock',
      topic: { slug: 'window', title: 'WINDOW', solved: 0, total: 5 },
      problem: null,
      missing: null,
      gate: null,
      cta: { label: 'Unlock WINDOW', href: '#topic-window' },
    });
  });

  it('prefers a topic you can unlock to one with tokens missing, whatever the order', () => {
    const f = pickFeaturedTopic(tiers([solved('arrays')], [locked('search', 'needs_tokens', [1]), locked('window', 'unlockable', [0])]));
    expect(f).toMatchObject({ reason: 'unlock', topic: { slug: 'window' } });
  });

  it('else features the topic closest to unlocking, by the tokens its cheapest recipe lacks', () => {
    const f = pickFeaturedTopic(tiers([solved('arrays')], [locked('search', 'needs_tokens', [3, 2]), locked('window', 'needs_tokens', [4, 5]), locked('recursion', 'needs_tokens', [6])]));
    expect(f).toEqual({
      reason: 'missing',
      topic: { slug: 'search', title: 'SEARCH', solved: 0, total: 5 },
      problem: null,
      missing: 2,
      gate: null,
      cta: { label: 'See what’s missing', href: '#topic-search' },
    });
  });

  it('breaks a tie toward an open tier, then the curriculum order', () => {
    const f1 = pickFeaturedTopic(tiers([solved('arrays')], [locked('search', 'tier_closed', [1]), locked('window', 'needs_tokens', [1])]));
    expect(f1).toMatchObject({ reason: 'missing', topic: { slug: 'window' }, missing: 1 });
    const f2 = pickFeaturedTopic(tiers([solved('arrays')], [locked('search', 'needs_tokens', [2]), locked('window', 'needs_tokens', [2])]));
    expect(f2).toMatchObject({ topic: { slug: 'search' } });
  });

  it('counts the tokens a closed tier’s topic lacks too, so a ready recipe behind a gate is the closest', () => {
    const f = pickFeaturedTopic(tiers([solved('arrays')], [locked('search', 'tier_closed', [0]), locked('window', 'needs_tokens', [2])]));
    expect(f).toMatchObject({ reason: 'missing', topic: { slug: 'search' }, missing: 0 });
  });

  it('still points at a topic without any recipe (a content gap) when it is all that is left', () => {
    const f = pickFeaturedTopic(tiers([solved('arrays')], [locked('search', 'no_recipe')]));
    expect(f).toMatchObject({ reason: 'missing', topic: { slug: 'search' }, missing: null, cta: { href: '#topic-search' } });
  });

  it('congratulates, on the last topic, when every topic is open and every problem solved', () => {
    const f = pickFeaturedTopic(tiers([solved('arrays'), solved('stack')], [solved('graphs')]));
    expect(f).toEqual({
      reason: 'done',
      topic: { slug: 'graphs', title: 'GRAPHS', solved: 2, total: 2 },
      problem: null,
      missing: null,
      gate: null,
      cta: { label: 'See your submissions', href: '/submissions' },
    });
  });

  it('treats an unlocked topic whose only unsolved problems are closed ones as done', () => {
    const f = pickFeaturedTopic(tiers([unlocked('pointers', [problem('a', 'solved'), problem('three-sum', 'todo', [{ slug: 'sorting' }])])]));
    expect(f).toMatchObject({ reason: 'done', topic: { slug: 'pointers' } });
  });

  it('has nothing to feature without topics', () => {
    expect(pickFeaturedTopic([])).toBeNull();
    expect(pickFeaturedTopic(tiers([]))).toBeNull();
  });
});

describe('pickFeaturedTopic: a gate that can be taken', () => {
  const solved = (slug: string) => unlocked(slug, [problem(`${slug}-1`, 'solved'), problem(`${slug}-2`, 'solved')]);
  /** Tier 0 is done; tier 1 is closed behind `g`. */
  const closed = (g: Gate | null) => [tier('Foundations', [solved('arrays')]), tier('Core techniques', [locked('search', 'tier_closed', [1]), locked('window', 'tier_closed', [2])], g)];

  it('offers it, once everything open is solved, instead of “See what’s missing”', () => {
    const f = pickFeaturedTopic(closed(gate('g1')));
    expect(f).toEqual({
      reason: 'gate',
      // the art is the first topic the gate opens; the topic's own words are not what the hero says
      topic: { slug: 'search', title: 'SEARCH', solved: 0, total: 5 },
      problem: null,
      missing: null,
      gate: { id: 'g1', title: 'Gate g1', tierTitle: 'Core techniques', passThreshold: 3, questionCount: 4, timeLimitMinutes: 45 },
      cta: { label: 'Take the Gate g1', href: '#gate-g1' },
    });
  });

  it('never displaces a problem to solve: a learner with something left is sent to it', () => {
    const tiersWithWork = [tier('Foundations', [unlocked('arrays', [problem('a', 'solved'), problem('b')])]), ...closed(gate('g1')).slice(1)];
    expect(pickFeaturedTopic(tiersWithWork)).toMatchObject({ reason: 'start', problem: { slug: 'b' }, gate: null });
    const tried = [tier('Foundations', [unlocked('arrays', [problem('a', 'solved'), problem('b', 'attempted')])]), ...closed(gate('g1')).slice(1)];
    expect(pickFeaturedTopic(tried)).toMatchObject({ reason: 'continue', gate: null });
  });

  it('comes after a topic that is ready to unlock: tokens in hand are spent first', () => {
    const t = [tier('Foundations', [solved('arrays')]), tier('Core techniques', [locked('search', 'unlockable', [0])], gate('g1', 'passed')), tier('Graphs', [locked('graphs', 'tier_closed', [1])], gate('g2'))];
    expect(pickFeaturedTopic(t)).toMatchObject({ reason: 'unlock', topic: { slug: 'search' }, gate: null });
  });

  it('is offered only while it can be taken: not running, cooling down, passed, or behind a tier that is still closed', () => {
    for (const state of ['running', 'cooldown', 'passed', 'previous_tier_closed'] as const) {
      expect(pickFeaturedTopic(closed(gate('g1', state))), state).toMatchObject({ reason: 'missing', gate: null, cta: { label: 'See what’s missing' } });
    }
  });

  it('takes the first gate in curriculum order, and says which tier it opens', () => {
    const t = [tier('Foundations', [solved('arrays')]), tier('Core techniques', [solved('search')], gate('g1', 'passed')), tier('Graphs and more', [locked('graphs', 'tier_closed', [1])], gate('g2'))];
    expect(pickFeaturedTopic(t)).toMatchObject({ reason: 'gate', topic: { slug: 'graphs' }, gate: { id: 'g2', tierTitle: 'Graphs and more' }, cta: { href: '#gate-g2' } });
  });

  it('skips a gate whose tier has no topic to show', () => {
    const t = [tier('Foundations', [solved('arrays')]), tier('Empty', [], gate('g1'))];
    expect(pickFeaturedTopic(t)).toMatchObject({ reason: 'done' });
  });

  it('is not offered to a learner who has cleared everything: the congratulation stands', () => {
    const t = [tier('Foundations', [solved('arrays')]), tier('Core techniques', [solved('search')], gate('g1', 'passed'))];
    expect(pickFeaturedTopic(t)).toMatchObject({ reason: 'done', gate: null });
  });
});
