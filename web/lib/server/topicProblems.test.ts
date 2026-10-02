import { describe, expect, it } from 'vitest';
import type { Difficulty } from '@/lib/types';
import { prisma, setupTestDatabase } from './test/db';
import { makeGate, makeQuestion, makeSubmission, makeTier, makeTopic, makeUser, unlockTopicRow } from './test/factories';
import { compareCurriculum, listTopicProblems, userQuestionProgress, type CurriculumKey } from './topicProblems';

setupTestDatabase();

async function question(
  slug: string,
  title: string,
  difficulty: Difficulty,
  topics: { topicId: string; weight?: number }[],
  status?: 'draft' | 'published'
) {
  const q = await makeQuestion({ slug, difficulty, topics, status });
  return prisma.question.update({ where: { id: q.id }, data: { title } });
}

/**
 * tier 0: arrays (ord 0), strings (ord 1) — free
 * tier 1: graphs — locked until unlocked
 */
async function world() {
  const tier0 = await makeTier(0);
  const tier1 = await makeTier(1);
  const arrays = await makeTopic(tier0.id, { slug: 'arrays', ord: 0 });
  const strings = await makeTopic(tier0.id, { slug: 'strings', ord: 1 });
  const graphs = await makeTopic(tier1.id, { slug: 'graphs', ord: 0 });
  const twoSum = await question('two-sum', 'Two Sum', 'Easy', [{ topicId: arrays.id }]);
  const maxSub = await question('max-sub', 'Maximum Subarray', 'Medium', [{ topicId: arrays.id }]);
  const anagram = await question('anagram', 'Valid Anagram', 'Easy', [{ topicId: strings.id }]);
  const islands = await question('islands', 'Number of Islands', 'Medium', [{ topicId: graphs.id }]);
  // A composite: heaviest topic graphs (tier 1), also strings (tier 0).
  const ladder = await question('ladder', 'Word Ladder', 'Hard', [
    { topicId: strings.id, weight: 0.5 },
    { topicId: graphs.id, weight: 1 },
  ]);
  await question('draft', 'Secret Draft', 'Easy', [{ topicId: arrays.id }], 'draft');
  return { tier0, tier1, arrays, strings, graphs, twoSum, maxSub, anagram, islands, ladder };
}

const slugs = (list: { slug: string }[] | undefined) => (list ?? []).map((p) => p.slug);

describe('listTopicProblems', () => {
  it('lists every published question under each of its topics, in curriculum order', async () => {
    const w = await world();
    const user = await makeUser();
    const { byTopic, unfiled } = await listTopicProblems(user.id);

    expect(slugs(byTopic.get(w.arrays.id))).toEqual(['two-sum', 'max-sub']); // Easy, then Medium; never the draft
    // The composite lists under both of its topics, and keeps its place in the curriculum:
    // its primary (heaviest) topic is graphs, in tier 1, so it comes after the tier-0 question.
    expect(slugs(byTopic.get(w.strings.id))).toEqual(['anagram', 'ladder']);
    expect(slugs(byTopic.get(w.graphs.id))).toEqual(['islands', 'ladder']);
    expect(byTopic.get(w.graphs.id)?.[1]).toMatchObject({ title: 'Word Ladder', difficulty: 'Hard', topicIds: [w.graphs.id, w.strings.id] });
    expect(unfiled).toEqual([]);
  });

  it('marks what opens: every topic unlocked, or a question of a running gate attempt', async () => {
    const w = await world();
    const user = await makeUser();
    const open = async () => {
      const { byTopic } = await listTopicProblems(user.id);
      return Object.fromEntries([...byTopic.values()].flat().map((p) => [p.slug, p.open]));
    };

    expect(await open()).toEqual({ 'two-sum': true, 'max-sub': true, anagram: true, islands: false, ladder: false });

    const gate = await makeGate(w.tier1.id, { questionIds: [w.islands.id] });
    await prisma.gateAttempt.create({ data: { userId: user.id, gateId: gate.id, deadlineAt: new Date(Date.now() + 3_600_000) } });
    expect(await open()).toMatchObject({ islands: true, ladder: false });

    await unlockTopicRow(user.id, w.graphs.id);
    expect(await open()).toMatchObject({ islands: true, ladder: true });
  });

  it('carries this learner’s progress', async () => {
    const w = await world();
    const user = await makeUser();
    const other = await makeUser();
    await makeSubmission(user.id, { questionId: w.twoSum.id, kind: 'submit', status: 'OK' });
    await makeSubmission(user.id, { questionId: w.anagram.id, kind: 'submit', status: 'WA' });
    await makeSubmission(other.id, { questionId: w.maxSub.id, kind: 'submit', status: 'OK' });

    const { byTopic } = await listTopicProblems(user.id);
    expect(byTopic.get(w.arrays.id)?.map((p) => [p.slug, p.progress])).toEqual([
      ['two-sum', 'solved'],
      ['max-sub', 'todo'],
    ]);
    expect(byTopic.get(w.strings.id)?.map((p) => [p.slug, p.progress])).toEqual([
      ['anagram', 'attempted'],
      ['ladder', 'todo'],
    ]);
  });

  it('keeps published questions without a topic apart, so they can still be listed', async () => {
    const w = await world();
    const user = await makeUser();
    await question('loose', 'A Loose End', 'Medium', []);
    const { byTopic, unfiled } = await listTopicProblems(user.id);
    expect(unfiled).toMatchObject([{ slug: 'loose', topicIds: [], open: true, progress: 'todo' }]);
    expect([...byTopic.values()].flat().some((p) => p.slug === 'loose')).toBe(false);
    expect(byTopic.has(w.arrays.id)).toBe(true);
  });

  it('handles a map without questions', async () => {
    const user = await makeUser();
    expect(await listTopicProblems(user.id)).toEqual({ byTopic: new Map(), unfiled: [] });
  });
});

describe('userQuestionProgress', () => {
  it('derives solved / attempted from this user’s submissions only', async () => {
    const w = await world();
    const user = await makeUser();
    const other = await makeUser();
    await makeSubmission(user.id, { questionId: w.twoSum.id, kind: 'submit', status: 'WA' });
    await makeSubmission(user.id, { questionId: w.twoSum.id, kind: 'submit', status: 'OK' });
    await makeSubmission(user.id, { questionId: w.anagram.id, kind: 'submit', status: 'WA' });
    // An accepted *run* is only an attempt; an accepted gate submission is a solve.
    await makeSubmission(user.id, { questionId: w.maxSub.id, kind: 'run', status: 'OK' });
    await makeSubmission(user.id, { questionId: w.islands.id, kind: 'gate', status: 'OK' });
    await makeSubmission(other.id, { questionId: w.ladder.id, kind: 'submit', status: 'OK' });

    expect(Object.fromEntries(await userQuestionProgress(user.id))).toEqual({
      [w.twoSum.id]: 'solved',
      [w.anagram.id]: 'attempted',
      [w.maxSub.id]: 'attempted',
      [w.islands.id]: 'solved',
    });
  });
});

describe('compareCurriculum (pure)', () => {
  const key = (slug: string, primary: CurriculumKey['primary'], difficulty: Difficulty = 'Easy', title = slug): CurriculumKey => ({
    primary,
    difficulty,
    title,
    slug,
  });

  it('orders by the primary topic’s tier and place, then difficulty, title and slug; topic-less last', () => {
    const keys = [
      key('none', null),
      key('t1-easy', { tierOrd: 1, ord: 0 }),
      key('t0b-easy', { tierOrd: 0, ord: 1 }),
      key('t0a-hard', { tierOrd: 0, ord: 0 }, 'Hard'),
      key('t0a-easy-b', { tierOrd: 0, ord: 0 }, 'Easy', 'B'),
      key('t0a-easy-a', { tierOrd: 0, ord: 0 }, 'Easy', 'A'),
    ];
    expect([...keys].sort(compareCurriculum).map((k) => k.slug)).toEqual([
      't0a-easy-a',
      't0a-easy-b',
      't0a-hard',
      't0b-easy',
      't1-easy',
      'none',
    ]);
  });
});
