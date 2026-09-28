import { describe, expect, it } from 'vitest';
import {
  learnSequence,
  neighbors,
  pickContinue,
  stepHref,
  summarizeCheckpoint,
  trackProgress,
  type CheckpointAttemptRow,
  type LessonProgressRow,
  type TrackShape,
} from './learnProgress';

const t = (d: number) => new Date(Date.UTC(2026, 8, d, 12));

const track: TrackShape = {
  slug: 'foundations',
  modules: [
    {
      id: 'm1',
      slug: 'arrays',
      title: 'Arrays',
      checkpointCount: 3,
      lessons: [
        { id: 'l1', slug: 'intro', title: 'Intro', estMinutes: 8 },
        { id: 'l2', slug: 'hashing', title: 'Hashing', estMinutes: 10 },
      ],
    },
    {
      id: 'm2',
      slug: 'pointers',
      title: 'Pointers',
      checkpointCount: 0,
      lessons: [{ id: 'l3', slug: 'two-ends', title: 'Two ends', estMinutes: 12 }],
    },
  ],
};

const done = (lessonId: string, day: number): [string, LessonProgressRow] => [
  lessonId,
  { lessonId, status: 'completed', startedAt: t(day), completedAt: t(day) },
];
const started = (lessonId: string, day: number): [string, LessonProgressRow] => [
  lessonId,
  { lessonId, status: 'started', startedAt: t(day), completedAt: null },
];
const attempt = (score: number, total: number, passed: boolean, day: number): CheckpointAttemptRow => ({
  moduleId: 'm1',
  score,
  total,
  passed,
  createdAt: t(day),
});

describe('learnSequence / neighbors', () => {
  it('orders lessons, then the module checkpoint (only when it has questions)', () => {
    expect(learnSequence(track).map((s) => (s.kind === 'lesson' ? s.lessonSlug : `${s.moduleSlug}:checkpoint`))).toEqual([
      'intro',
      'hashing',
      'arrays:checkpoint',
      'two-ends',
    ]);
  });

  it('links prev/next across modules and through checkpoints', () => {
    const n = neighbors(track, { kind: 'lesson', moduleSlug: 'arrays', lessonSlug: 'hashing' });
    expect(n.prev).toMatchObject({ kind: 'lesson', lessonSlug: 'intro' });
    expect(n.next).toMatchObject({ kind: 'checkpoint', moduleSlug: 'arrays' });
    const c = neighbors(track, { kind: 'checkpoint', moduleSlug: 'arrays' });
    expect(c.next).toMatchObject({ kind: 'lesson', lessonSlug: 'two-ends' });
    expect(neighbors(track, { kind: 'lesson', moduleSlug: 'arrays', lessonSlug: 'intro' }).prev).toBeNull();
    expect(neighbors(track, { kind: 'lesson', moduleSlug: 'x', lessonSlug: 'nope' })).toEqual({ prev: null, next: null });
  });

  it('builds step URLs', () => {
    const [first, , cp] = learnSequence(track);
    expect(stepHref('foundations', first)).toBe('/learn/foundations/intro');
    expect(stepHref('foundations', cp)).toBe('/learn/foundations/arrays/checkpoint');
  });
});

describe('summarizeCheckpoint', () => {
  it('keeps the best ratio, first pass and last attempt', () => {
    const s = summarizeCheckpoint(3, [attempt(1, 3, false, 3), attempt(3, 3, true, 5), attempt(2, 3, false, 7)]);
    expect(s).toEqual({
      questions: 3,
      attempts: 3,
      passed: true,
      best: { score: 3, total: 3 },
      lastAttemptAt: t(7),
      passedAt: t(5),
    });
    expect(summarizeCheckpoint(3, [])).toMatchObject({ attempts: 0, passed: false, best: null, lastAttemptAt: null });
  });
});

describe('trackProgress', () => {
  it('starts empty with the first lesson next', () => {
    const p = trackProgress(track, new Map(), new Map());
    expect(p).toMatchObject({ lessonsDone: 0, lessonsTotal: 3, checkpointsPassed: 0, checkpointsTotal: 1, percent: 0, complete: false, started: false });
    expect(p.next).toMatchObject({ kind: 'lesson', lessonSlug: 'intro' });
    expect(p.estMinutes).toBe(30);
  });

  it('points at the first unfinished lesson, even out of order', () => {
    const p = trackProgress(track, new Map([done('l2', 2), started('l1', 1)]), new Map());
    expect(p.modules[0].lessons.map((l) => l.state)).toEqual(['started', 'completed']);
    expect(p.next).toMatchObject({ kind: 'lesson', lessonSlug: 'intro' });
    expect(p.started).toBe(true);
    expect(p.lastActivityAt).toEqual(t(2));
  });

  it('sends the learner to the checkpoint once a module’s lessons are done', () => {
    const p = trackProgress(track, new Map([done('l1', 1), done('l2', 2)]), new Map([['m1', [attempt(1, 3, false, 3)]]]));
    expect(p.next).toMatchObject({ kind: 'checkpoint', moduleSlug: 'arrays' });
    expect(p.percent).toBe(50); // 2 of (3 lessons + 1 checkpoint)
    expect(p.modules[0].complete).toBe(false);
  });

  it('is complete only with every lesson done and every checkpoint passed', () => {
    const lessons = new Map([done('l1', 1), done('l2', 2), done('l3', 4)]);
    const notYet = trackProgress(track, lessons, new Map([['m1', [attempt(1, 3, false, 3)]]]));
    expect(notYet.complete).toBe(false);
    expect(notYet.percent).toBe(75);
    expect(notYet.next).toMatchObject({ kind: 'checkpoint' });

    const p = trackProgress(track, lessons, new Map([['m1', [attempt(1, 3, false, 3), attempt(3, 3, true, 6)]]]));
    expect(p).toMatchObject({ complete: true, percent: 100, next: null, completedAt: t(6) });
  });

  it('never shows 100% before completion', () => {
    const big: TrackShape = {
      slug: 'x',
      modules: [{ id: 'm', slug: 'm', title: 'M', checkpointCount: 0, lessons: Array.from({ length: 200 }, (_, i) => ({ id: `l${i}`, slug: `s${i}`, title: '', estMinutes: 1 })) }],
    };
    const rows = new Map(Array.from({ length: 199 }, (_, i) => done(`l${i}`, 1)));
    expect(trackProgress(big, rows, new Map()).percent).toBe(99);
  });
});

describe('pickContinue', () => {
  const other: TrackShape = {
    slug: 'search',
    modules: [{ id: 'm9', slug: 'bs', title: 'Binary search', checkpointCount: 0, lessons: [{ id: 'l9', slug: 'halving', title: 'Halving', estMinutes: 5 }] }],
  };

  it('is null without any activity', () => {
    const items = [track, other].map((tr) => ({ tr, progress: trackProgress(tr, new Map(), new Map()) }));
    expect(pickContinue(items)).toBeNull();
  });

  it('resumes the most recently active unfinished track', () => {
    const lessons = new Map([done('l1', 1), started('l9', 5)]);
    const items = [track, other].map((tr) => ({ tr, progress: trackProgress(tr, lessons, new Map()) }));
    const c = pickContinue(items)!;
    expect(c.track.tr.slug).toBe('search');
    expect(c.step).toMatchObject({ lessonSlug: 'halving' });
  });

  it('moves on to an unfinished track when the active one is complete', () => {
    const lessons = new Map([done('l9', 9)]);
    const items = [other, track].map((tr) => ({ tr, progress: trackProgress(tr, lessons, new Map()) }));
    const c = pickContinue(items)!;
    expect(c.track.tr.slug).toBe('foundations');
  });
});
