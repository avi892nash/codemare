import { describe, expect, it } from 'vitest';
import { completeLesson } from './learn';
import { findProfileUser, getBadgeGalleryView, getProfile, loadBadgeStats } from './profile';
import { prisma, setupTestDatabase } from './test/db';
import { grant, makeBuildStep, makeComponent, makeQuestion, makeSubmission, makeTier, makeTopic, makeUser, makeWorld } from './test/factories';

setupTestDatabase();

const NOW = new Date(Date.UTC(2026, 8, 28, 15)); // 2026-09-28
const daysAgo = (n: number, h = 12) => new Date(Date.UTC(2026, 8, 28 - n, h));

describe('findProfileUser', () => {
  it('finds by handle case-insensitively and rejects malformed handles', async () => {
    const u = await makeUser({ handle: 'ada_l' });
    expect((await findProfileUser('ADA_L'))?.id).toBe(u.id);
    expect(await findProfileUser('nobody')).toBeNull();
    expect(await findProfileUser('../etc')).toBeNull();
    expect(await findProfileUser("x' OR 1=1 --")).toBeNull();
    expect((await findProfileUser('ada_l'))?.name).toBe('ada_l'); // no name → handle
  });
});

describe('getProfile', () => {
  it('returns null for an unknown handle', async () => {
    expect(await getProfile('ghost_user', null, NOW)).toBeNull();
  });

  it('computes solves, acceptance, fastest run, streaks and the heatmap', async () => {
    const w = await makeWorld();
    const user = await makeUser({ handle: 'grace' });
    const viewer = await makeUser();
    const medium = await makeQuestion({ slug: 'mid', difficulty: 'Medium', topics: [{ topicId: w.arrays.id }] });
    const draft = await makeQuestion({ slug: 'drafty', status: 'draft', topics: [{ topicId: w.arrays.id }] });

    await makeSubmission(user.id, { questionId: w.q1.id, runtimeUs: 900, createdAt: daysAgo(3) });
    await makeSubmission(user.id, { questionId: w.q1.id, runtimeUs: 400, createdAt: daysAgo(2) }); // same question again
    await makeSubmission(user.id, { questionId: medium.id, runtimeUs: 2500, createdAt: daysAgo(1) });
    await makeSubmission(user.id, { questionId: w.q2.id, status: 'WA', createdAt: daysAgo(1) });
    await makeSubmission(user.id, { questionId: w.q2.id, kind: 'run', status: 'OK', runtimeUs: 5, createdAt: daysAgo(1) }); // runs never count
    await makeSubmission(user.id, { questionId: draft.id, runtimeUs: 1, createdAt: daysAgo(0) }); // a draft is not "fastest"
    await makeSubmission(user.id, { questionId: w.q2.id, createdAt: daysAgo(10) });
    await makeSubmission(user.id, { questionId: w.q2.id, createdAt: daysAgo(500) }); // outside the heatmap

    const p = (await getProfile('grace', viewer.id, NOW))!;
    expect(p.isOwner).toBe(false);
    expect(p.solved.total).toBe(4); // q1, mid, q2, drafty (a solve is a solve)
    expect(p.solved.byDifficulty).toEqual({ Easy: 3, Medium: 1, Hard: 0 });
    expect(p.solved.catalog).toEqual({ Easy: 2, Medium: 1, Hard: 0 }); // published only
    // judged submit/gate: 6 OK + 1 WA (the run is excluded)
    expect(p.acceptance).toEqual({ accepted: 6, judged: 7, rate: 86 });
    expect(p.fastest).toEqual({ runtimeUs: 400, language: 'python', question: { slug: 'q-arrays', title: 'q-arrays' } });
    expect(p.streak).toEqual({ current: 4, longest: 4 }); // days 3,2,1,0
    expect(p.activity.days).toHaveLength(365);
    expect(p.activity.total).toBe(7); // every kind counts; the 500-day-old one is outside the year
    expect(p.activity.days.at(-1)).toMatchObject({ day: '2026-09-28', count: 1 });
    expect(p.recent).toHaveLength(8);
    expect(p.recent[0].target).toBeNull(); // the draft question is not shown
    expect(p.recent.find((r) => r.target?.kind === 'question' && r.target.slug === 'mid')).toBeTruthy();
  });

  it('shows tokens, earned badges, learn progress and built components', async () => {
    const tier = await makeTier(0);
    const topic = await makeTopic(tier.id, { slug: 'arrays' });
    const user = await makeUser({ handle: 'linus' });
    await grant(user.id, topic.id, 'Easy', 3);
    const badge = await prisma.badge.create({
      data: { slug: 'first', name: 'First', description: 'd', icon: 'check', rarity: 'common', criteria: { kind: 'first_accept' }, ord: 0 },
    });
    await prisma.badgeAward.create({ data: { userId: user.id, badgeId: badge.id } });
    const comp = await makeComponent({ topicId: topic.id, slug: 'bsearch' });
    const step = await makeBuildStep(comp.id);
    for (const language of ['python', 'python', 'javascript'] as const) {
      const sub = await makeSubmission(user.id, { kind: 'build', buildStepId: step.id, language });
      await prisma.componentVersion.create({
        data: { userId: user.id, componentId: comp.id, language, code: 'x', passed: true, submissionId: sub.id },
      });
    }
    const track = await prisma.track.create({ data: { slug: 't', title: 'T', summary: '', level: 'beginner', estHours: 1, ord: 0 } });
    const mod = await prisma.learnModule.create({ data: { trackId: track.id, slug: 'm', title: 'M', summary: '', ord: 0 } });
    const lesson = await prisma.lesson.create({ data: { moduleId: mod.id, slug: 'l', title: 'L', ord: 0, estMinutes: 3, bodyMd: 'x' } });
    await completeLesson(user.id, lesson.id);

    const p = (await getProfile('linus', user.id, NOW))!;
    expect(p.isOwner).toBe(true);
    expect(p.tokens).toMatchObject({ total: 3, topics: [{ slug: 'arrays', total: 3 }] });
    expect(p.badges.earned.map((b) => b.slug)).toEqual(['first']);
    expect(p.badges.total).toBe(1);
    expect(p.learn).toEqual([
      expect.objectContaining({ slug: 't', lessonsDone: 1, lessonsTotal: 1, complete: true, percent: 100 }),
    ]);
    expect(p.components).toEqual([expect.objectContaining({ slug: 'bsearch', languages: ['python', 'javascript'] })]);
    expect(p.recent[0].target).toEqual({ kind: 'build', title: 'bsearch · step' });
  });

  it('never exposes the email', async () => {
    const user = await makeUser({ handle: 'privacy', email: 'secret@example.dev' });
    const p = await getProfile('privacy', null, NOW);
    expect(JSON.stringify(p)).not.toContain('secret@example.dev');
    expect(p?.user.id).toBe(user.id);
  });
});

describe('badge gallery view', () => {
  it('pairs every badge with progress, earned state and how widely it is held', async () => {
    const w = await makeWorld();
    const user = await makeUser({ handle: 'hopper' });
    await makeUser();
    const solves = await prisma.badge.create({
      data: { slug: 'solver', name: 'Solver', description: 'Solve 3', icon: 'flame', rarity: 'rare', criteria: { kind: 'solves', n: 3 }, ord: 0 },
    });
    const first = await prisma.badge.create({
      data: { slug: 'first', name: 'First', description: 'd', icon: 'check', rarity: 'common', criteria: { kind: 'first_accept' }, ord: 1 },
    });
    await prisma.badge.create({
      data: { slug: 'broken', name: 'Broken', description: 'bad criteria', icon: 'x', rarity: 'epic', criteria: { kind: 'nope' }, ord: 2 },
    });
    await makeSubmission(user.id, { questionId: w.q1.id });
    await prisma.badgeAward.create({ data: { userId: user.id, badgeId: first.id } });

    const warn = console.warn;
    console.warn = () => {};
    const g = (await getBadgeGalleryView('hopper', user.id))!;
    console.warn = warn;
    expect(g.isOwner).toBe(true);
    expect(g.earned).toBe(1);
    expect(g.badges.map((b) => b.slug)).toEqual(['solver', 'first', 'broken']);
    const [solver, firstB, broken] = g.badges;
    expect(solver).toMatchObject({ awardedAt: null, howTo: 'Solve 3 different problems.', progress: { current: 1, target: 3 }, heldByPercent: 0 });
    expect(firstB.awardedAt).toBeInstanceOf(Date);
    expect(firstB.heldByPercent).toBe(50); // 1 of 2 users
    expect(broken).toMatchObject({ criteria: null, progress: null, howTo: 'bad criteria' });
    expect(solves.id).toBeTruthy();
    expect(await getBadgeGalleryView('ghost_user', null)).toBeNull();
  });

  it('loads the stats the badge rules use', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await makeSubmission(user.id, { questionId: w.q1.id, createdAt: daysAgo(2) });
    await makeSubmission(user.id, { questionId: w.q2.id, createdAt: daysAgo(1) });
    const stats = await loadBadgeStats(user.id);
    expect(stats).toMatchObject({
      solveCount: 2,
      solvesByDifficulty: { Easy: 2, Medium: 0, Hard: 0 },
      longestStreak: 2,
      noHintSolves: 2,
      componentsBuilt: 0,
      topicsUnlocked: 0,
      openTierOrds: [0],
      gateFirstTry: false,
      lessonsCompleted: 0,
      tracksCompleted: 0,
      bestPercentile: null,
      bestTrackFraction: 0,
    });
  });
});
