import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@/lib/types';
import { chooseNextProblem, getNextProblem } from './nextProblem';
import { prisma, setupTestDatabase } from './test/db';
import { makeGate, makeQuestion, makeSubmission, makeTier, makeTopic, makeUser, unlockTopicRow } from './test/factories';
import type { ProblemProgress, TopicProblem } from './topicProblems';

setupTestDatabase();

// ─── the choice, pure ──────────────────────────────────────────────────────

const problem = (id: string, over: Partial<TopicProblem> = {}): TopicProblem => ({
  id,
  slug: id,
  title: id.toUpperCase(),
  difficulty: 'Easy',
  topicIds: ['a'],
  progress: 'todo',
  open: true,
  ...over,
});

/** Topics a → b → c in curriculum order. */
const order = ['a', 'b', 'c'];
const lists = (entries: Record<string, TopicProblem[]>) => new Map(Object.entries(entries));
const slugOf = (r: ReturnType<typeof chooseNextProblem>) => r && `${r.topicId}:${r.problem.slug}`;

describe('chooseNextProblem (pure)', () => {
  it('takes the next unsolved problem of the same topic after the current one', () => {
    const byTopic = lists({ a: [problem('a1'), problem('a2'), problem('a3')], b: [problem('b1', { topicIds: ['b'] })] });
    expect(slugOf(chooseNextProblem({ currentId: 'a1', currentTopicIds: ['a'], topicOrder: order, byTopic }))).toBe('a:a2');
    expect(slugOf(chooseNextProblem({ currentId: 'a2', currentTopicIds: ['a'], topicOrder: order, byTopic }))).toBe('a:a3');
  });

  it('skips what is solved or does not open, and never offers the current problem again', () => {
    const progress = (p: ProblemProgress) => ({ progress: p });
    const byTopic = lists({
      a: [
        problem('a1'),
        problem('a2', progress('solved')),
        problem('a3', { open: false }),
        problem('a4', { ...progress('attempted') }), // a failed try is not a solve
        problem('a5'),
      ],
    });
    expect(slugOf(chooseNextProblem({ currentId: 'a1', currentTopicIds: ['a'], topicOrder: order, byTopic }))).toBe('a:a4');
    byTopic.get('a')![3] = problem('a4', progress('solved'));
    expect(slugOf(chooseNextProblem({ currentId: 'a1', currentTopicIds: ['a'], topicOrder: order, byTopic }))).toBe('a:a5');
  });

  it('moves on to the following topics, in curriculum order, when the topic is done', () => {
    const byTopic = lists({
      a: [problem('a1'), problem('a2', { progress: 'solved' })],
      b: [problem('b1', { topicIds: ['b'], progress: 'solved' }), problem('b2', { topicIds: ['b'], open: false })],
      c: [problem('c1', { topicIds: ['c'] })],
    });
    // b has nothing that is both unsolved and open → c.
    expect(slugOf(chooseNextProblem({ currentId: 'a1', currentTopicIds: ['a'], topicOrder: order, byTopic }))).toBe('c:c1');
  });

  it('does not look backwards: earlier problems and earlier topics stay where they are', () => {
    const byTopic = lists({
      a: [problem('a1'), problem('a2')],
      b: [problem('b1', { topicIds: ['b'] }), problem('b2', { topicIds: ['b'] })],
    });
    // On the last problem of b with a1/a2/b1 still unsolved: nothing ahead.
    expect(chooseNextProblem({ currentId: 'b2', currentTopicIds: ['b'], topicOrder: order, byTopic })).toBeNull();
    // On b1 the next one is b2, not a1.
    expect(slugOf(chooseNextProblem({ currentId: 'b1', currentTopicIds: ['b'], topicOrder: order, byTopic }))).toBe('b:b2');
  });

  it('has nothing to offer when everything ahead is solved or locked — the result then shows the map only', () => {
    const byTopic = lists({
      a: [problem('a1')],
      b: [problem('b1', { topicIds: ['b'], open: false })],
      c: [problem('c1', { topicIds: ['c'], progress: 'solved' })],
    });
    expect(chooseNextProblem({ currentId: 'a1', currentTopicIds: ['a'], topicOrder: order, byTopic })).toBeNull();
  });

  it('files a composite question under its heaviest topic, and skips it where it appears again', () => {
    const composite = problem('x', { topicIds: ['a', 'c'] });
    const byTopic = lists({ a: [composite, problem('a2')], b: [], c: [composite, problem('c2', { topicIds: ['c'] })] });
    // Solving it from topic a: the next problem in a is a2.
    expect(slugOf(chooseNextProblem({ currentId: 'x', currentTopicIds: ['a', 'c'], topicOrder: order, byTopic }))).toBe('a:a2');
    // With a done, topic c's list offers c2 — not the composite itself.
    byTopic.set('a', [composite, problem('a2', { progress: 'solved' })]);
    expect(slugOf(chooseNextProblem({ currentId: 'x', currentTopicIds: ['a', 'c'], topicOrder: order, byTopic }))).toBe('c:c2');
  });

  it('copes with a current question that is not in its topic’s list (a draft) or has no topic', () => {
    const byTopic = lists({ a: [problem('a1'), problem('a2')] });
    expect(slugOf(chooseNextProblem({ currentId: 'draft', currentTopicIds: ['a'], topicOrder: order, byTopic }))).toBe('a:a1');
    expect(chooseNextProblem({ currentId: 'loose', currentTopicIds: [], topicOrder: order, byTopic })).toBeNull();
    expect(chooseNextProblem({ currentId: 'x', currentTopicIds: ['unknown'], topicOrder: order, byTopic })).toBeNull();
    expect(chooseNextProblem({ currentId: 'a1', currentTopicIds: ['a'], topicOrder: [], byTopic: new Map() })).toBeNull();
  });
});

// ─── with a database ───────────────────────────────────────────────────────

async function question(slug: string, difficulty: Difficulty, topics: { topicId: string; weight?: number }[]) {
  return makeQuestion({ slug, difficulty, topics });
}

/**
 * tier 0 (free): arrays (ord 0: two-sum Easy, max-sub Medium), strings (ord 1: anagram Easy)
 * tier 1: graphs (ord 2: islands) — locked until its topic is unlocked
 */
async function world() {
  const tier0 = await makeTier(0);
  const tier1 = await makeTier(1);
  const arrays = await makeTopic(tier0.id, { slug: 'arrays', ord: 0 });
  const strings = await makeTopic(tier0.id, { slug: 'strings', ord: 1 });
  const graphs = await makeTopic(tier1.id, { slug: 'graphs', ord: 2 });
  const twoSum = await question('two-sum', 'Easy', [{ topicId: arrays.id }]);
  const maxSub = await question('max-sub', 'Medium', [{ topicId: arrays.id }]);
  const anagram = await question('anagram', 'Easy', [{ topicId: strings.id }]);
  const islands = await question('islands', 'Medium', [{ topicId: graphs.id }]);
  return { tier0, tier1, arrays, strings, graphs, twoSum, maxSub, anagram, islands };
}

describe('getNextProblem', () => {
  it('follows the curriculum for a fresh learner: same topic first, then the next topic', async () => {
    const w = await world();
    const user = await makeUser();
    expect(await getNextProblem(user.id, w.twoSum.id)).toEqual({ slug: 'max-sub', title: 'max-sub', difficulty: 'Medium', topicTitle: 'arrays' });
    await makeSubmission(user.id, { questionId: w.maxSub.id, kind: 'submit', status: 'OK' });
    expect(await getNextProblem(user.id, w.twoSum.id)).toEqual({ slug: 'anagram', title: 'anagram', difficulty: 'Easy', topicTitle: 'strings' });
  });

  it('never points at a locked problem — a closed tier ends the trail until it opens', async () => {
    const w = await world();
    const user = await makeUser();
    await makeSubmission(user.id, { questionId: w.maxSub.id, kind: 'submit', status: 'OK' });
    await makeSubmission(user.id, { questionId: w.anagram.id, kind: 'submit', status: 'OK' });
    expect(await getNextProblem(user.id, w.twoSum.id)).toBeNull(); // islands is locked

    await unlockTopicRow(user.id, w.graphs.id);
    expect(await getNextProblem(user.id, w.twoSum.id)).toMatchObject({ slug: 'islands', topicTitle: 'graphs' });
  });

  it('offers a locked problem that belongs to the learner’s running gate attempt (it opens for them)', async () => {
    const w = await world();
    const user = await makeUser();
    await makeSubmission(user.id, { questionId: w.maxSub.id, kind: 'submit', status: 'OK' });
    await makeSubmission(user.id, { questionId: w.anagram.id, kind: 'submit', status: 'OK' });
    const gate = await makeGate(w.tier1.id, { questionIds: [w.islands.id] });
    await prisma.gateAttempt.create({ data: { userId: user.id, gateId: gate.id, deadlineAt: new Date(Date.now() + 3_600_000) } });
    expect(await getNextProblem(user.id, w.twoSum.id)).toMatchObject({ slug: 'islands' });
  });

  it('is about this learner: another learner’s solves do not count', async () => {
    const w = await world();
    const user = await makeUser();
    const other = await makeUser();
    await makeSubmission(other.id, { questionId: w.maxSub.id, kind: 'submit', status: 'OK' });
    expect(await getNextProblem(user.id, w.twoSum.id)).toMatchObject({ slug: 'max-sub' });
  });

  it('has nothing for a question without a topic, or a learner who has done everything open', async () => {
    const w = await world();
    const user = await makeUser();
    const loose = await question('loose', 'Easy', []);
    expect(await getNextProblem(user.id, loose.id)).toBeNull();
    for (const q of [w.twoSum, w.maxSub, w.anagram]) await makeSubmission(user.id, { questionId: q.id, kind: 'submit', status: 'OK' });
    expect(await getNextProblem(user.id, w.twoSum.id)).toBeNull();
  });
});
