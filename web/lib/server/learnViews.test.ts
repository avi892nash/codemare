import { describe, expect, it } from 'vitest';
import { completeLesson, submitCheckpoint } from './learn';
import {
  findLessonId,
  findModuleId,
  getCheckpointReview,
  getCheckpointView,
  getLearnHome,
  getLessonView,
  getQuestionRefs,
  getRelatedLessons,
  getTrackCompletion,
  getTrackView,
} from './learnViews';
import { prisma, setupTestDatabase } from './test/db';
import { makeQuestion, makeSubmission, makeTier, makeTopic, makeUser } from './test/factories';

setupTestDatabase();

/** Two tracks; the first has a module with a 2-question checkpoint and a module without one. */
async function makeLearnWorld() {
  const tier = await makeTier(0);
  const arrays = await makeTopic(tier.id, { slug: 'arrays' });
  const graphs = await makeTopic(tier.id, { slug: 'graphs' });
  const twoSum = await makeQuestion({ slug: 'two-sum', topics: [{ topicId: arrays.id }] });
  const draft = await makeQuestion({ slug: 'secret-draft', status: 'draft', topics: [{ topicId: arrays.id }] });
  const islands = await makeQuestion({ slug: 'islands', difficulty: 'Medium', topics: [{ topicId: graphs.id }] });
  const track = await prisma.track.create({
    data: { slug: 'basics', title: 'Basics', summary: 's', level: 'beginner', estHours: 2, ord: 0, tierId: tier.id },
  });
  const m1 = await prisma.learnModule.create({ data: { trackId: track.id, slug: 'arrays', title: 'Arrays', summary: 'a', ord: 0 } });
  const m2 = await prisma.learnModule.create({ data: { trackId: track.id, slug: 'more', title: 'More', summary: 'b', ord: 1 } });
  const body = 'Intro\n\n```python run\nprint(1)\n```\n\n:::question{slug=two-sum}\n\n:::question{slug=secret-draft}';
  const l1 = await prisma.lesson.create({
    data: { moduleId: m1.id, slug: 'one-pass', title: 'One pass', ord: 0, estMinutes: 8, bodyMd: body, topicId: arrays.id, relatedQuestionSlugs: ['two-sum'] },
  });
  const l2 = await prisma.lesson.create({
    data: { moduleId: m1.id, slug: 'hashing', title: 'Hashing', ord: 1, estMinutes: 6, bodyMd: 'Hash it.', topicId: arrays.id },
  });
  const l3 = await prisma.lesson.create({
    data: { moduleId: m2.id, slug: 'wrap-up', title: 'Wrap up', ord: 0, estMinutes: 4, bodyMd: 'Done.', relatedQuestionSlugs: ['islands'] },
  });
  const q1 = await prisma.checkpointQuestion.create({
    data: { moduleId: m1.id, ord: 0, kind: 'mcq', promptMd: 'Lookup cost?', choices: ['O(1)', 'O(n)'], answer: 0, explanationMd: 'Hashing.' },
  });
  const q2 = await prisma.checkpointQuestion.create({
    data: { moduleId: m1.id, ord: 1, kind: 'short', promptMd: 'Name it', answer: ['two pointers', 'two-pointers'], explanationMd: 'Ends.' },
  });
  const other = await prisma.track.create({ data: { slug: 'graphs', title: 'Graphs', summary: '', level: 'advanced', estHours: 3, ord: 1 } });
  const gm = await prisma.learnModule.create({ data: { trackId: other.id, slug: 'bfs', title: 'BFS', summary: '', ord: 0 } });
  const g1 = await prisma.lesson.create({
    data: { moduleId: gm.id, slug: 'layers', title: 'Layers', ord: 0, estMinutes: 9, bodyMd: 'BFS.', topicId: graphs.id },
  });
  return { tier, arrays, graphs, twoSum, draft, islands, track, m1, m2, l1, l2, l3, q1, q2, other, gm, g1 };
}

describe('learn home and track views', () => {
  it('lists tracks in order with per-user progress and no continue point before any activity', async () => {
    const w = await makeLearnWorld();
    const user = await makeUser();
    const home = await getLearnHome(user.id);
    expect(home.tracks.map((t) => t.track.slug)).toEqual(['basics', 'graphs']);
    expect(home.tracks[0].track.tier).toMatchObject({ ord: 0 });
    expect(home.tracks[0].progress).toMatchObject({ lessonsTotal: 3, checkpointsTotal: 1, percent: 0 });
    expect(home.continue).toBeNull();

    await completeLesson(user.id, w.l1.id);
    const after = await getLearnHome(user.id);
    expect(after.continue?.track.track.slug).toBe('basics');
    expect(after.continue?.step).toMatchObject({ kind: 'lesson', lessonSlug: 'hashing' });
    expect(after.totals).toMatchObject({ lessonsDone: 1, lessonsTotal: 4 });
  });

  it('returns null for unknown tracks', async () => {
    const user = await makeUser();
    expect(await getTrackView(user.id, 'nope')).toBeNull();
    expect(await getLessonView(user.id, 'nope', 'x')).toBeNull();
  });

  it('keeps progress per user', async () => {
    const w = await makeLearnWorld();
    const a = await makeUser();
    const b = await makeUser();
    await completeLesson(a.id, w.l1.id);
    expect((await getTrackView(a.id, 'basics'))!.progress.lessonsDone).toBe(1);
    expect((await getTrackView(b.id, 'basics'))!.progress.lessonsDone).toBe(0);
  });
});

describe('getLessonView', () => {
  it('parses the body, resolves published question cards with solved state, and links neighbors', async () => {
    const w = await makeLearnWorld();
    const user = await makeUser();
    await makeSubmission(user.id, { questionId: w.twoSum.id });
    const v = (await getLessonView(user.id, 'basics', 'one-pass'))!;
    expect(v.lesson).toMatchObject({ title: 'One pass', state: 'not_started', topic: { slug: 'arrays' } });
    expect(v.blocks.map((b) => b.type)).toEqual(['markdown', 'code', 'question', 'question']);
    expect(v.questions.get('two-sum')).toMatchObject({ title: 'two-sum', solved: true, topic: 'arrays' });
    expect(v.questions.has('secret-draft')).toBe(false); // drafts never surface
    expect(v.nav.prev).toBeNull();
    expect(v.nav.next).toMatchObject({ kind: 'lesson', lessonSlug: 'hashing' });

    const last = (await getLessonView(user.id, 'basics', 'hashing'))!;
    expect(last.nav.next).toMatchObject({ kind: 'checkpoint', moduleSlug: 'arrays' });
    // a lesson slug from another track does not resolve here
    expect(await getLessonView(user.id, 'basics', 'layers')).toBeNull();
  });

  it('finds ids by slug pairs', async () => {
    const w = await makeLearnWorld();
    expect(await findLessonId('basics', 'hashing')).toBe(w.l2.id);
    expect(await findLessonId('graphs', 'hashing')).toBeNull();
    expect(await findModuleId('basics', 'arrays')).toBe(w.m1.id);
    expect(await findModuleId('basics', 'bfs')).toBeNull();
  });
});

describe('checkpoints', () => {
  it('serves questions without answers or explanations', async () => {
    await makeLearnWorld();
    const user = await makeUser();
    const v = (await getCheckpointView(user.id, 'basics', 'arrays'))!;
    expect(v.questions).toHaveLength(2);
    expect(v.questions[0]).toEqual({ id: expect.any(String), kind: 'mcq', promptMd: 'Lookup cost?', choices: ['O(1)', 'O(n)'] });
    expect(v.questions[1].choices).toEqual([]);
    expect(JSON.stringify(v.questions)).not.toMatch(/Hashing\.|two pointers|answer|explanation/i);
    expect(v.passRatio).toBe(0.7);
    // no checkpoint on this module, unknown module
    expect(await getCheckpointView(user.id, 'basics', 'more')).toBeNull();
    expect(await getCheckpointView(user.id, 'basics', 'zzz')).toBeNull();
  });

  it('reviews a graded attempt with answers, only for its owner', async () => {
    const w = await makeLearnWorld();
    const user = await makeUser();
    const other = await makeUser();
    const res = await submitCheckpoint(user.id, w.m1.id, { [w.q1.id]: 1, [w.q2.id]: '  Two   Pointers ' });
    const review = (await getCheckpointReview(user.id, w.m1.id, res.attemptId))!;
    expect(review.attempt).toMatchObject({ score: 1, total: 2, passed: false });
    expect(review.items[0]).toMatchObject({ correct: false, given: 'O(n)', givenIndex: 1, expected: 'O(1)', expectedIndex: 0, explanationMd: 'Hashing.' });
    expect(review.items[1]).toMatchObject({ correct: true, given: 'Two   Pointers', expected: 'two pointers' });
    expect(await getCheckpointReview(other.id, w.m1.id, res.attemptId)).toBeNull();
    expect(await getCheckpointReview(user.id, w.m2.id, res.attemptId)).toBeNull();
  });

  it('handles unanswered and malformed responses', async () => {
    const w = await makeLearnWorld();
    const user = await makeUser();
    const res = await submitCheckpoint(user.id, w.m1.id, { [w.q1.id]: 'banana' });
    const review = (await getCheckpointReview(user.id, w.m1.id, res.attemptId))!;
    expect(review.items.map((i) => [i.correct, i.given])).toEqual([
      [false, null],
      [false, null],
    ]);
  });
});

describe('getTrackCompletion', () => {
  it('reports completion, learn badges, the next track and practice questions', async () => {
    const w = await makeLearnWorld();
    const user = await makeUser();
    await prisma.badge.create({
      data: { slug: 'graduate', name: 'Graduate', description: '', icon: 'graduation', rarity: 'rare', criteria: { kind: 'track_completed' }, ord: 0 },
    });
    await prisma.badge.create({
      data: { slug: 'first', name: 'First', description: '', icon: 'check', rarity: 'common', criteria: { kind: 'first_accept' }, ord: 1 },
    });
    const before = (await getTrackCompletion(user.id, 'basics'))!;
    expect(before.progress.complete).toBe(false);
    expect(before.badges).toEqual([]);

    for (const l of [w.l1, w.l2, w.l3]) await completeLesson(user.id, l.id);
    const passed = await submitCheckpoint(user.id, w.m1.id, { [w.q1.id]: 0, [w.q2.id]: 'two-pointers' });
    expect(passed.badgesAwarded.map((b) => b.slug)).toEqual(['graduate']);

    const done = (await getTrackCompletion(user.id, 'basics'))!;
    expect(done.progress).toMatchObject({ complete: true, percent: 100 });
    expect(done.progress.completedAt).toBeInstanceOf(Date);
    expect(done.badges.map((b) => b.slug)).toEqual(['graduate']); // first_accept is not a learn badge
    expect(done.nextTrack?.track.slug).toBe('graphs');
    expect(done.practice.map((q) => q.slug).sort()).toEqual(['islands', 'two-sum']);
    expect(await getTrackCompletion(user.id, 'nope')).toBeNull();
  });
});

describe('getRelatedLessons / getQuestionRefs', () => {
  it('prefers lessons that list the question, else lessons on its main topic', async () => {
    const w = await makeLearnWorld();
    const user = await makeUser();
    await completeLesson(user.id, w.l1.id);
    const direct = await getRelatedLessons('two-sum', user.id);
    expect(direct).toEqual([
      { href: '/learn/basics/one-pass', title: 'One pass', estMinutes: 8, trackTitle: 'Basics', moduleTitle: 'Arrays', completed: true, direct: true },
    ]);
    // islands is listed by l3; a topic-only question falls back to its topic's lessons
    const q = await makeQuestion({ slug: 'bfs-grid', topics: [{ topicId: w.graphs.id }] });
    const byTopic = await getRelatedLessons(q.slug, null);
    expect(byTopic.map((l) => l.href)).toEqual(['/learn/graphs/layers']);
    expect(byTopic[0]).toMatchObject({ direct: false, completed: false });
    expect(await getRelatedLessons('unknown-question')).toEqual([]);
    expect(await getRelatedLessons('secret-draft')).toEqual([]);
  });

  it('caps the strip', async () => {
    const w = await makeLearnWorld();
    for (let i = 0; i < 6; i++) {
      await prisma.lesson.create({
        data: { moduleId: w.m2.id, slug: `extra-${i}`, title: `Extra ${i}`, ord: 10 + i, estMinutes: 1, bodyMd: 'x', relatedQuestionSlugs: ['two-sum'] },
      });
    }
    expect(await getRelatedLessons('two-sum', null)).toHaveLength(4);
    expect(await getRelatedLessons('two-sum', null, 2)).toHaveLength(2);
  });

  it('returns an empty map for no slugs', async () => {
    expect((await getQuestionRefs([])).size).toBe(0);
  });
});
