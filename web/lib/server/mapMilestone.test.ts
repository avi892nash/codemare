import { describe, expect, it } from 'vitest';
import { pickMilestone, type MilestoneTierInput, type MilestoneTopicInput } from './mapMilestone';

type Gate = NonNullable<MilestoneTierInput['gate']>;

const topic = (slug: string, state: MilestoneTopicInput['state']): MilestoneTopicInput => ({ slug, title: slug.toUpperCase(), state });
/** A gate of 4 problems that passes with 3, of which the learner has solved `solvedCount`. */
const gate = (id: string, state: Gate['state'], solvedCount: number, passThreshold = 3): Gate => ({ id, title: `Gate ${id}`, state, solvedCount, passThreshold, questionCount: 4 });
const tier = (slug: string, topics: MilestoneTopicInput[], g: Gate | null = null): MilestoneTierInput => ({ slug, title: slug.toUpperCase(), gate: g, topics });
const hero = (reason: 'start' | 'continue' | 'unlock' | 'gate' | 'missing' | 'done', slug: string, gateId?: string) => ({ reason, topic: { slug }, gate: gateId ? { id: gateId } : null });

describe('pickMilestone: a topic that is ready to unlock', () => {
  const tiers = [tier('t0', [topic('arrays', 'unlocked')]), tier('t1', [topic('search', 'unlockable'), topic('window', 'needs_tokens')], gate('g1', 'passed', 4))];

  it('says so under a hero that is about a problem, and links to the topic’s card', () => {
    for (const reason of ['start', 'continue'] as const) {
      expect(pickMilestone(tiers, hero(reason, 'arrays'))).toEqual({
        kind: 'unlock',
        lead: '',
        subject: 'SEARCH',
        text: ' is ready to unlock',
        cta: { label: 'Unlock', href: '#topic-search', sr: ' SEARCH' },
      });
    }
  });

  it('stays quiet when the hero is already about that very topic (each fact once)', () => {
    expect(pickMilestone(tiers, hero('unlock', 'search'))).toBeNull();
  });

  it('still names a second ready topic when the hero features the first', () => {
    const two = [tier('t1', [topic('search', 'unlockable'), topic('window', 'unlockable')])];
    expect(pickMilestone(two, hero('unlock', 'search'))).toMatchObject({ kind: 'unlock', subject: 'WINDOW', cta: { href: '#topic-window' } });
  });

  it('takes the first ready topic in curriculum order across tiers', () => {
    const two = [tier('t0', [topic('arrays', 'unlocked')]), tier('t1', [topic('window', 'unlockable')]), tier('t2', [topic('graphs', 'unlockable')])];
    expect(pickMilestone(two, hero('start', 'arrays'))).toMatchObject({ subject: 'WINDOW' });
  });

  it('ignores topics that are not ready: unlocked, short of tokens, behind a closed tier, without a recipe', () => {
    const none = [tier('t0', [topic('a', 'unlocked'), topic('b', 'needs_tokens'), topic('c', 'tier_closed'), topic('d', 'no_recipe')])];
    expect(pickMilestone(none, hero('start', 'a'))).toBeNull();
  });
});

describe('pickMilestone: a gate the learner is ready for', () => {
  const closed = (g: Gate) => [tier('t0', [topic('arrays', 'unlocked')]), tier('t1', [topic('search', 'tier_closed')], g)];

  it('says so, plainly and with the count, once they have solved as many of its problems as it takes to pass', () => {
    expect(pickMilestone(closed(gate('g1', 'eligible', 3)), hero('start', 'arrays'))).toEqual({
      kind: 'gate',
      lead: 'You can take the ',
      subject: 'Gate g1',
      text: ' now — 3 of its 4 problems solved',
      cta: { label: 'Take the gate', href: '#gate-g1' },
    });
    expect(pickMilestone(closed(gate('g1', 'eligible', 4)), hero('missing', 'search'))).toMatchObject({ kind: 'gate', text: ' now — 4 of its 4 problems solved' });
  });

  it('says nothing earlier: at zero, one or two solved of four the gate is not a milestone', () => {
    for (const solved of [0, 1, 2]) {
      expect(pickMilestone(closed(gate('g1', 'eligible', solved)), hero('start', 'arrays')), `${solved} solved`).toBeNull();
    }
  });

  it('follows the gate’s own pass threshold, not a fixed number', () => {
    expect(pickMilestone(closed(gate('g1', 'eligible', 3, 4)), hero('start', 'arrays'))).toBeNull();
    expect(pickMilestone(closed(gate('g1', 'eligible', 4, 4)), hero('start', 'arrays'))).toMatchObject({ kind: 'gate' });
    expect(pickMilestone(closed(gate('g1', 'eligible', 2, 2)), hero('start', 'arrays'))).toMatchObject({ kind: 'gate', text: ' now — 2 of its 4 problems solved' });
  });

  it('only a gate that can be taken counts: not one that is running (it has its banner), cooling down, passed or behind a closed tier', () => {
    for (const state of ['running', 'cooldown', 'passed', 'previous_tier_closed'] as const) {
      expect(pickMilestone(closed(gate('g1', state, 4)), hero('start', 'arrays')), state).toBeNull();
    }
  });

  it('is not said twice: when the hero is already offering that gate there is no line', () => {
    expect(pickMilestone(closed(gate('g1', 'eligible', 4)), hero('gate', 'search', 'g1'))).toBeNull();
  });

  it('takes the first such gate in curriculum order', () => {
    const tiers = [tier('t0', []), tier('t1', [], gate('g1', 'eligible', 3)), tier('t2', [], gate('g2', 'eligible', 4))];
    expect(pickMilestone(tiers, null)).toMatchObject({ kind: 'gate', cta: { href: '#gate-g1' } });
  });

  it('skips one that is not ready for the next that is', () => {
    const tiers = [tier('t0', []), tier('t1', [], gate('g1', 'eligible', 1)), tier('t2', [], gate('g2', 'eligible', 3))];
    expect(pickMilestone(tiers, null)).toMatchObject({ kind: 'gate', subject: 'Gate g2' });
  });

  it('puts a ready topic before a gate: one line, the more exciting one', () => {
    const tiers = [tier('t0', [topic('arrays', 'unlocked')]), tier('t1', [topic('search', 'unlockable')], gate('g1', 'passed', 4)), tier('t2', [topic('graphs', 'tier_closed')], gate('g2', 'eligible', 3))];
    expect(pickMilestone(tiers, hero('start', 'arrays'))).toMatchObject({ kind: 'unlock', subject: 'SEARCH' });
  });

  it('falls through to the gate when the only ready topic is the hero’s own', () => {
    const tiers = [tier('t1', [topic('search', 'unlockable')], gate('g1', 'passed', 4)), tier('t2', [topic('graphs', 'tier_closed')], gate('g2', 'eligible', 3))];
    expect(pickMilestone(tiers, hero('unlock', 'search'))).toMatchObject({ kind: 'gate', cta: { href: '#gate-g2' } });
  });
});

describe('pickMilestone: nothing to say', () => {
  it('is null for a fresh learner, for an empty map and without a hero', () => {
    const fresh = [tier('t0', [topic('arrays', 'unlocked')]), tier('t1', [topic('search', 'tier_closed')], gate('g1', 'eligible', 0))];
    expect(pickMilestone(fresh, hero('start', 'arrays'))).toBeNull();
    expect(pickMilestone([], null)).toBeNull();
    expect(pickMilestone(fresh, null)).toBeNull();
  });

  it('is null when everything is open and done', () => {
    const done = [tier('t0', [topic('arrays', 'unlocked')]), tier('t1', [topic('search', 'unlocked')], gate('g1', 'passed', 4))];
    expect(pickMilestone(done, hero('done', 'search'))).toBeNull();
  });
});
