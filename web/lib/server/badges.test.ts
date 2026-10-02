import { describe, expect, it, vi } from 'vitest';
import type { BadgeCriteria } from '@/lib/types';
import { unlockTopic } from './access';
import { evaluateBadges, getBadgeGallery } from './badges';
import { finishGate, startGate } from './gates';
import { completeLesson, submitCheckpoint } from './learn';
import { EmailTaken, HandleTaken, createUserWithHandle, generateHandle } from './users';
import { prisma, setupTestDatabase } from './test/db';
import {
  grant,
  makeHints,
  makeQuestion,
  makeRecipe,
  makeSubmission,
  makeUser,
  makeWorld,
} from './test/factories';

setupTestDatabase();

let ord = 0;
async function badge(slug: string, criteria: BadgeCriteria | Record<string, unknown>) {
  return prisma.badge.create({
    data: { slug, name: slug, description: '', icon: 'award', rarity: 'common', criteria: criteria as object, ord: ord++ },
  });
}
const slugs = (list: { slug: string }[]) => list.map((b) => b.slug).sort();
const day = (d: number, h = 12) => new Date(Date.UTC(2026, 2, d, h));

describe('evaluateBadges', () => {
  it('awards solve-based badges once and only reports new ones', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await badge('first', { kind: 'first_accept' });
    await badge('two-solves', { kind: 'solves', n: 2 });
    await badge('one-medium', { kind: 'solves_difficulty', difficulty: 'Medium', n: 1 });
    const medium = await makeQuestion({ difficulty: 'Medium', topics: [{ topicId: w.arrays.id }] });

    await makeSubmission(user.id, { questionId: w.q1.id });
    await makeSubmission(user.id, { questionId: w.q1.id }); // same question twice
    await makeSubmission(user.id, { questionId: w.q2.id, status: 'WA' });
    await makeSubmission(user.id, { questionId: w.q2.id, kind: 'run' }); // runs never count
    expect(slugs(await evaluateBadges(user.id))).toEqual(['first']);

    await makeSubmission(user.id, { questionId: medium.id });
    expect(slugs(await evaluateBadges(user.id))).toEqual(['one-medium', 'two-solves']);
    expect(await evaluateBadges(user.id)).toEqual([]);
    expect(await prisma.badgeAward.count({ where: { userId: user.id } })).toBe(3);
  });

  it('counts UTC-day streaks and hint-free solves', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await badge('streak-3', { kind: 'streak_days', n: 3 });
    await badge('clean-2', { kind: 'no_hint_solves', n: 2 });
    const q3 = await makeQuestion({ topics: [{ topicId: w.arrays.id }] });
    const hints = await makeHints({ questionId: q3.id }, [{ level: 'nudge' }]);

    await makeSubmission(user.id, { questionId: w.q1.id, createdAt: day(1, 23) });
    await makeSubmission(user.id, { questionId: w.q2.id, createdAt: day(2, 0) });
    // Hint revealed before the first solve of q3 → not hint-free.
    await prisma.hintUse.create({ data: { userId: user.id, hintId: hints.nudge.id, questionId: q3.id, costKind: 'score', costAmount: 0, createdAt: day(2, 1) } });
    await makeSubmission(user.id, { questionId: q3.id, createdAt: day(4) }); // gap on the 3rd
    expect(slugs(await evaluateBadges(user.id))).toEqual(['clean-2']);

    await makeSubmission(user.id, { questionId: q3.id, createdAt: day(3) });
    expect(slugs(await evaluateBadges(user.id))).toEqual(['streak-3']);
  });

  it('awards unlock and gate badges through their hooks', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await badge('tier-1', { kind: 'tier_open', tier_ord: 1 });
    await badge('first-try', { kind: 'gate_first_try' });
    await badge('unlocker', { kind: 'topics_unlocked', n: 1 });

    const attempt = await startGate(user.id, w.gate.id);
    await makeSubmission(user.id, { kind: 'gate', questionId: w.q1.id, gateAttemptId: attempt.id });
    await makeSubmission(user.id, { kind: 'gate', questionId: w.q2.id, gateAttemptId: attempt.id });
    const finished = await finishGate(user.id, attempt.id);
    expect(finished.passed).toBe(true);
    expect(slugs(finished.badgesAwarded)).toEqual(['first-try', 'tier-1']);

    await makeRecipe(w.graphs.id, [{ topicId: w.arrays.id, quantity: 1 }]);
    await grant(user.id, w.arrays.id, 'Easy', 1);
    expect(slugs((await unlockTopic(user.id, w.graphs.id)).badgesAwarded)).toEqual(['unlocker']);
  });

  it('does not award gate_first_try after a failed first attempt', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await badge('first-try', { kind: 'gate_first_try' });
    const t0 = new Date('2026-06-01T00:00:00Z');
    const first = await startGate(user.id, w.gate.id, t0);
    await finishGate(user.id, first.id, new Date(t0.getTime() + 60_000));
    const t1 = new Date(t0.getTime() + 13 * 3_600_000);
    const second = await startGate(user.id, w.gate.id, t1);
    await makeSubmission(user.id, { kind: 'gate', questionId: w.q1.id, gateAttemptId: second.id, createdAt: t1 });
    await makeSubmission(user.id, { kind: 'gate', questionId: w.q2.id, gateAttemptId: second.id, createdAt: t1 });
    const r = await finishGate(user.id, second.id, new Date(t1.getTime() + 60_000));
    expect(r.passed).toBe(true);
    expect(r.badgesAwarded).toEqual([]);
  });

  it('awards learn badges on lesson completion and checkpoint pass', async () => {
    const user = await makeUser();
    await badge('lesson-2', { kind: 'lessons_completed', n: 2 });
    await badge('graduate', { kind: 'track_completed' });
    const track = await prisma.track.create({
      data: {
        slug: 't',
        title: 't',
        summary: '',
        level: 'beginner',
        estHours: 1,
        ord: 0,
        modules: {
          create: [
            {
              slug: 'm',
              title: 'm',
              summary: '',
              ord: 0,
              lessons: {
                create: [
                  { slug: 'l1', title: 'l1', ord: 0, bodyMd: '', estMinutes: 5 },
                  { slug: 'l2', title: 'l2', ord: 1, bodyMd: '', estMinutes: 5 },
                ],
              },
              checkpointQuestions: {
                create: [{ ord: 0, kind: 'mcq', promptMd: '?', choices: ['a', 'b'], answer: 1, explanationMd: '' }],
              },
            },
          ],
        },
      },
      include: { modules: { include: { lessons: true, checkpointQuestions: true } } },
    });
    const [mod] = track.modules;

    expect(await completeLesson(user.id, mod.lessons[0].id)).toEqual({ badgesAwarded: [] });
    expect(slugs((await completeLesson(user.id, mod.lessons[1].id)).badgesAwarded)).toEqual(['lesson-2']);
    expect((await completeLesson(user.id, mod.lessons[1].id)).badgesAwarded).toEqual([]); // idempotent

    const wrong = await submitCheckpoint(user.id, mod.id, { [mod.checkpointQuestions[0].id]: 0 });
    expect(wrong).toMatchObject({ score: 0, passed: false, badgesAwarded: [] });
    const right = await submitCheckpoint(user.id, mod.id, { [mod.checkpointQuestions[0].id]: 1 });
    expect(right.passed).toBe(true);
    expect(slugs(right.badgesAwarded)).toEqual(['graduate']);
  });

  it('awards fast_solve from the best percentile', async () => {
    const w = await makeWorld();
    const user = await makeUser();
    await badge('speedy', { kind: 'fast_solve', percentile: 90 });
    const s = await makeSubmission(user.id, { questionId: w.q1.id });
    await prisma.submission.update({ where: { id: s.id }, data: { percentile: 89.9 } });
    expect(await evaluateBadges(user.id)).toEqual([]);
    await prisma.submission.update({ where: { id: s.id }, data: { percentile: 95 } });
    expect(slugs(await evaluateBadges(user.id))).toEqual(['speedy']);
  });

  it('skips badges with malformed criteria instead of failing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const user = await makeUser();
    await badge('broken', { kind: 'nope' });
    await badge('first', { kind: 'first_accept' });
    const w = await makeWorld();
    await makeSubmission(user.id, { questionId: w.q1.id });
    expect(slugs(await evaluateBadges(user.id))).toEqual(['first']);
    const gallery = await getBadgeGallery(user.id);
    expect(gallery.map((b) => [b.slug, b.criteria === null, b.awardedAt !== null])).toEqual([
      ['broken', true, false],
      ['first', false, true],
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ignoring badge "broken"'));
    warn.mockRestore();
  });
});

describe('users', () => {
  it('generates unique lowercase handles from seeds', async () => {
    await makeUser({ handle: 'ada' });
    expect(await generateHandle(['Grace Hopper'])).toBe('grace_hopper');
    const h = await generateHandle(['ADA']);
    expect(h).toMatch(/^ada\d{2,}$/);
    expect(await generateHandle([null, '??'])).toBe('coder');
  });

  it('creates users with a chosen or generated handle', async () => {
    const chosen = await createUserWithHandle({ email: 'a@x.dev' }, { handle: 'alan_t' });
    expect(chosen.handle).toBe('alan_t');
    await expect(createUserWithHandle({ email: 'b@x.dev' }, { handle: 'alan_t' })).rejects.toBeInstanceOf(HandleTaken);
    await expect(createUserWithHandle({ email: 'a@x.dev' }, { handle: 'other' })).rejects.toBeInstanceOf(EmailTaken);
    const generated = await createUserWithHandle({ email: 'alan.t@x.dev', name: null });
    expect(generated.handle).toMatch(/^alan_t\d+$/);
  });
});
