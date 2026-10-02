import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@/lib/types';
import { pickFeaturedTopic, type FeaturedTopicInput } from './featuredTopic';
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

describe('pickFeaturedTopic: a topic with something to solve', () => {
  it('starts a fresh learner on the first problem of the first topic', () => {
    const f = pickFeaturedTopic(tiers([unlocked('arrays', [problem('contains-duplicate'), problem('two-sum')]), unlocked('stack', [problem('valid-parentheses')])], [locked('search', 'tier_closed', [0])]));
    expect(f).toEqual({
      reason: 'start',
      topic: { slug: 'arrays', title: 'ARRAYS', solved: 0, total: 2 },
      problem: { slug: 'contains-duplicate', title: 'Contains duplicate', difficulty: 'Easy' },
      missing: null,
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
