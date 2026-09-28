import 'server-only';
import type { Prisma } from '@prisma/client';
import type { CheckpointAnswer, CheckpointKind, Difficulty, TrackLevel } from '@/lib/types';
import { parseLesson, questionSlugs, type LessonBlock } from '@/lib/lesson-markdown/parse';
import { prisma } from './db';
import { getBadgeGallery, type BadgeWithStatus } from './badges';
import { CHECKPOINT_PASS_RATIO, isCheckpointAnswerCorrect } from './rules/checkpoints';
import {
  neighbors,
  pickContinue,
  trackProgress,
  type CheckpointAttemptRow,
  type LearnStep,
  type LessonProgressRow,
  type LessonState,
  type ModuleProgress,
  type ModuleShape,
  type TrackProgress,
  type TrackShape,
} from './rules/learnProgress';

/**
 * Read models for the learn pages (L1–L3, L6, L7, L8). Writes go through
 * learn.ts (`startLesson`, `completeLesson`, `submitCheckpoint`), which also
 * run badge evaluation. Progress rules are pure (rules/learnProgress.ts).
 *
 * Checkpoint answers and explanations are only ever read for a graded
 * attempt (`getCheckpointReview`); the quiz view never carries them.
 */

export type { LearnStep, LessonState, ModuleProgress, TrackProgress };

// ─── Shapes ──────────────────────────────────────────────────────────────

const trackSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  level: true,
  estHours: true,
  ord: true,
  tier: { select: { slug: true, title: true, ord: true } },
  modules: {
    orderBy: { ord: 'asc' },
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      ord: true,
      lessons: { orderBy: { ord: 'asc' }, select: { id: true, slug: true, title: true, estMinutes: true } },
      _count: { select: { checkpointQuestions: true } },
    },
  },
} satisfies Prisma.TrackSelect;

type TrackRow = Prisma.TrackGetPayload<{ select: typeof trackSelect }>;

export interface ModuleCore extends ModuleShape {
  summary: string;
  ord: number;
}

export interface TrackCore extends TrackShape {
  id: string;
  slug: string;
  title: string;
  summary: string;
  level: TrackLevel;
  estHours: number;
  ord: number;
  tier: { slug: string; title: string; ord: number } | null;
  modules: ModuleCore[];
}

function toCore(t: TrackRow): TrackCore {
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    summary: t.summary,
    level: t.level,
    estHours: t.estHours,
    ord: t.ord,
    tier: t.tier,
    modules: t.modules.map((m) => ({
      id: m.id,
      slug: m.slug,
      title: m.title,
      summary: m.summary,
      ord: m.ord,
      lessons: m.lessons,
      checkpointCount: m._count.checkpointQuestions,
    })),
  };
}

export interface TrackWithProgress {
  track: TrackCore;
  progress: TrackProgress;
}

interface UserLearnState {
  lessons: Map<string, LessonProgressRow>;
  attempts: Map<string, CheckpointAttemptRow[]>;
}

async function loadUserState(userId: string, tracks: readonly TrackCore[]): Promise<UserLearnState> {
  const lessonIds = tracks.flatMap((t) => t.modules.flatMap((m) => m.lessons.map((l) => l.id)));
  const moduleIds = tracks.flatMap((t) => t.modules.map((m) => m.id));
  const [rows, attempts] = await Promise.all([
    lessonIds.length
      ? prisma.lessonProgress.findMany({
          where: { userId, lessonId: { in: lessonIds } },
          select: { lessonId: true, status: true, startedAt: true, completedAt: true },
        })
      : [],
    moduleIds.length
      ? prisma.checkpointAttempt.findMany({
          where: { userId, moduleId: { in: moduleIds } },
          select: { moduleId: true, score: true, total: true, passed: true, createdAt: true },
        })
      : [],
  ]);
  const byModule = new Map<string, CheckpointAttemptRow[]>();
  for (const a of attempts) byModule.set(a.moduleId, [...(byModule.get(a.moduleId) ?? []), a]);
  return { lessons: new Map(rows.map((r) => [r.lessonId, r])), attempts: byModule };
}

async function loadTrack(slug: string): Promise<TrackCore | null> {
  const t = await prisma.track.findUnique({ where: { slug }, select: trackSelect });
  return t ? toCore(t) : null;
}

// ─── Question references (link cards, related-question strips) ───────────

export interface QuestionRef {
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** Highest-weight topic title. */
  topic: string | null;
  solved: boolean;
}

/** Published questions by slug (missing / draft ones are absent from the map). */
export async function getQuestionRefs(slugs: readonly string[], userId?: string | null): Promise<Map<string, QuestionRef>> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return new Map();
  const questions = await prisma.question.findMany({
    where: { slug: { in: unique }, status: 'published' },
    select: {
      id: true,
      slug: true,
      title: true,
      difficulty: true,
      topics: { orderBy: { weight: 'desc' }, take: 1, select: { topic: { select: { title: true } } } },
    },
  });
  const solved = new Set<string>();
  if (userId && questions.length) {
    const rows = await prisma.submission.findMany({
      where: { userId, status: 'OK', kind: { in: ['submit', 'gate'] }, questionId: { in: questions.map((q) => q.id) } },
      distinct: ['questionId'],
      select: { questionId: true },
    });
    for (const r of rows) if (r.questionId) solved.add(r.questionId);
  }
  return new Map(
    questions.map((q) => [
      q.slug,
      { slug: q.slug, title: q.title, difficulty: q.difficulty, topic: q.topics[0]?.topic.title ?? null, solved: solved.has(q.id) },
    ])
  );
}

// ─── L3: learn home ──────────────────────────────────────────────────────

export interface LearnHome {
  tracks: TrackWithProgress[];
  continue: { track: TrackWithProgress; step: LearnStep } | null;
  totals: { lessonsDone: number; lessonsTotal: number; checkpointsPassed: number; tracksComplete: number };
}

export async function getLearnHome(userId: string): Promise<LearnHome> {
  const rows = await prisma.track.findMany({ orderBy: { ord: 'asc' }, select: trackSelect });
  const tracks = rows.map(toCore);
  const state = await loadUserState(userId, tracks);
  const items = tracks.map((track) => ({ track, progress: trackProgress(track, state.lessons, state.attempts) }));
  return {
    tracks: items,
    continue: pickContinue(items),
    totals: {
      lessonsDone: items.reduce((n, t) => n + t.progress.lessonsDone, 0),
      lessonsTotal: items.reduce((n, t) => n + t.progress.lessonsTotal, 0),
      checkpointsPassed: items.reduce((n, t) => n + t.progress.checkpointsPassed, 0),
      tracksComplete: items.filter((t) => t.progress.complete).length,
    },
  };
}

// ─── L2: track ───────────────────────────────────────────────────────────

export async function getTrackView(userId: string, trackSlug: string): Promise<TrackWithProgress | null> {
  const track = await loadTrack(trackSlug);
  if (!track) return null;
  const state = await loadUserState(userId, [track]);
  return { track, progress: trackProgress(track, state.lessons, state.attempts) };
}

// ─── L1: lesson ──────────────────────────────────────────────────────────

export interface LessonView extends TrackWithProgress {
  module: ModuleCore;
  moduleIndex: number;
  moduleProgress: ModuleProgress;
  lesson: {
    id: string;
    slug: string;
    title: string;
    estMinutes: number;
    state: LessonState;
    completedAt: Date | null;
    topic: { slug: string; title: string; icon: string } | null;
    relatedQuestionSlugs: string[];
  };
  blocks: LessonBlock[];
  questions: Map<string, QuestionRef>;
  nav: { prev: LearnStep | null; next: LearnStep | null };
}

export async function getLessonView(userId: string, trackSlug: string, lessonSlug: string): Promise<LessonView | null> {
  const track = await loadTrack(trackSlug);
  if (!track) return null;
  const moduleIndex = track.modules.findIndex((m) => m.lessons.some((l) => l.slug === lessonSlug));
  if (moduleIndex < 0) return null;
  const mod = track.modules[moduleIndex];
  const shape = mod.lessons.find((l) => l.slug === lessonSlug)!;

  const [row, state] = await Promise.all([
    prisma.lesson.findUnique({
      where: { id: shape.id },
      select: { bodyMd: true, relatedQuestionSlugs: true, topic: { select: { slug: true, title: true, icon: true } } },
    }),
    loadUserState(userId, [track]),
  ]);
  if (!row) return null;
  const progress = trackProgress(track, state.lessons, state.attempts);
  const moduleProgress = progress.modules[moduleIndex];
  const lp = moduleProgress.lessons.find((l) => l.lesson.id === shape.id)!;
  const blocks = parseLesson(row.bodyMd);
  const questions = await getQuestionRefs([...questionSlugs(blocks), ...row.relatedQuestionSlugs], userId);

  return {
    track,
    progress,
    module: mod,
    moduleIndex,
    moduleProgress,
    lesson: {
      id: shape.id,
      slug: shape.slug,
      title: shape.title,
      estMinutes: shape.estMinutes,
      state: lp.state,
      completedAt: lp.completedAt,
      topic: row.topic,
      relatedQuestionSlugs: row.relatedQuestionSlugs,
    },
    blocks,
    questions,
    nav: neighbors(track, { kind: 'lesson', moduleSlug: mod.slug, lessonSlug }),
  };
}

// ─── L6: checkpoint ──────────────────────────────────────────────────────

export interface CheckpointQuestionView {
  id: string;
  kind: CheckpointKind;
  promptMd: string;
  /** mcq only. */
  choices: string[];
}

export interface CheckpointView extends TrackWithProgress {
  module: ModuleCore;
  moduleIndex: number;
  moduleProgress: ModuleProgress;
  questions: CheckpointQuestionView[];
  passRatio: number;
  nav: { prev: LearnStep | null; next: LearnStep | null };
}

function parseChoices(raw: Prisma.JsonValue | null): string[] {
  return Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
}

export async function getCheckpointView(userId: string, trackSlug: string, moduleSlug: string): Promise<CheckpointView | null> {
  const track = await loadTrack(trackSlug);
  if (!track) return null;
  const moduleIndex = track.modules.findIndex((m) => m.slug === moduleSlug);
  if (moduleIndex < 0) return null;
  const mod = track.modules[moduleIndex];
  if (mod.checkpointCount === 0) return null;
  const [questions, state] = await Promise.all([
    prisma.checkpointQuestion.findMany({
      where: { moduleId: mod.id },
      orderBy: { ord: 'asc' },
      // Never select `answer` / `explanationMd` here.
      select: { id: true, kind: true, promptMd: true, choices: true },
    }),
    loadUserState(userId, [track]),
  ]);
  const progress = trackProgress(track, state.lessons, state.attempts);
  return {
    track,
    progress,
    module: mod,
    moduleIndex,
    moduleProgress: progress.modules[moduleIndex],
    questions: questions.map((q) => ({ id: q.id, kind: q.kind, promptMd: q.promptMd, choices: q.kind === 'mcq' ? parseChoices(q.choices) : [] })),
    passRatio: CHECKPOINT_PASS_RATIO,
    nav: neighbors(track, { kind: 'checkpoint', moduleSlug }),
  };
}

export interface ReviewItem {
  id: string;
  kind: CheckpointKind;
  promptMd: string;
  choices: string[];
  /** The learner's answer as shown (choice text for mcq). */
  given: string | null;
  /** mcq: the chosen index. */
  givenIndex: number | null;
  correct: boolean;
  /** The expected answer as shown (choice text for mcq, first accepted answer for short). */
  expected: string;
  expectedIndex: number | null;
  explanationMd: string;
}

export interface CheckpointReview {
  attempt: { id: string; score: number; total: number; passed: boolean; createdAt: Date };
  items: ReviewItem[];
}

/** A graded attempt of the user's own, with answers and explanations. null if not theirs / not this module. */
export async function getCheckpointReview(userId: string, moduleId: string, attemptId: string): Promise<CheckpointReview | null> {
  const attempt = await prisma.checkpointAttempt.findFirst({
    where: { id: attemptId, userId, moduleId },
    select: { id: true, score: true, total: true, passed: true, createdAt: true, answers: true },
  });
  if (!attempt) return null;
  const questions = await prisma.checkpointQuestion.findMany({
    where: { moduleId },
    orderBy: { ord: 'asc' },
    select: { id: true, kind: true, promptMd: true, choices: true, answer: true, explanationMd: true },
  });
  const responses =
    attempt.answers && typeof attempt.answers === 'object' && !Array.isArray(attempt.answers)
      ? (attempt.answers as Record<string, unknown>)
      : {};
  const items = questions.map((q): ReviewItem => {
    const answer = q.answer as CheckpointAnswer;
    const choices = q.kind === 'mcq' ? parseChoices(q.choices) : [];
    const response = responses[q.id];
    const correct = isCheckpointAnswerCorrect({ id: q.id, kind: q.kind, answer }, response);
    if (q.kind === 'mcq') {
      const idx = typeof response === 'number' ? response : typeof response === 'string' && response.trim() !== '' ? Number(response) : NaN;
      const givenIndex = Number.isInteger(idx) && idx >= 0 && idx < choices.length ? idx : null;
      const expectedIndex = typeof answer === 'number' ? answer : null;
      return {
        id: q.id,
        kind: q.kind,
        promptMd: q.promptMd,
        choices,
        given: givenIndex === null ? null : choices[givenIndex],
        givenIndex,
        correct,
        expected: expectedIndex === null ? '' : (choices[expectedIndex] ?? ''),
        expectedIndex,
        explanationMd: q.explanationMd,
      };
    }
    const accepted = Array.isArray(answer) ? answer : [String(answer)];
    return {
      id: q.id,
      kind: q.kind,
      promptMd: q.promptMd,
      choices,
      given: typeof response === 'string' && response.trim() ? response.trim() : null,
      givenIndex: null,
      correct,
      expected: accepted[0] ?? '',
      expectedIndex: null,
      explanationMd: q.explanationMd,
    };
  });
  const { answers: _answers, ...meta } = attempt;
  return { attempt: meta, items };
}

// ─── L7: track completion ────────────────────────────────────────────────

export interface TrackCompletion extends TrackWithProgress {
  /** Learn badges the user holds (lessons / track criteria), newest first. */
  badges: BadgeWithStatus[];
  nextTrack: TrackWithProgress | null;
  /** Related questions across the track's lessons, unsolved first. */
  practice: QuestionRef[];
}

export async function getTrackCompletion(userId: string, trackSlug: string): Promise<TrackCompletion | null> {
  const rows = await prisma.track.findMany({ orderBy: { ord: 'asc' }, select: trackSelect });
  const tracks = rows.map(toCore);
  const track = tracks.find((t) => t.slug === trackSlug);
  if (!track) return null;
  const [state, gallery, related] = await Promise.all([
    loadUserState(userId, tracks),
    getBadgeGallery(userId),
    prisma.lesson.findMany({
      where: { module: { trackId: track.id } },
      select: { relatedQuestionSlugs: true },
    }),
  ]);
  const items = tracks.map((t) => ({ track: t, progress: trackProgress(t, state.lessons, state.attempts) }));
  const me = items.find((i) => i.track.slug === trackSlug)!;
  const after = items.filter((i) => i.track.ord > track.ord && !i.progress.complete);
  const nextTrack = after[0] ?? items.find((i) => i.track.slug !== trackSlug && !i.progress.complete) ?? null;
  const refs = await getQuestionRefs(related.flatMap((l) => l.relatedQuestionSlugs), userId);
  const practice = [...refs.values()].sort((a, b) => Number(a.solved) - Number(b.solved)).slice(0, 6);
  const badges = gallery
    .filter((b) => b.awardedAt && (b.criteria?.kind === 'lessons_completed' || b.criteria?.kind === 'track_completed'))
    .sort((a, b) => b.awardedAt!.getTime() - a.awardedAt!.getTime());
  return { ...me, badges, nextTrack, practice };
}

// ─── L8: related lessons for a problem page ──────────────────────────────

export interface RelatedLesson {
  href: string;
  title: string;
  estMinutes: number;
  trackTitle: string;
  moduleTitle: string;
  completed: boolean;
  /** true when the lesson lists the question; false when matched by topic only. */
  direct: boolean;
}

const relatedSelect = {
  id: true,
  slug: true,
  title: true,
  estMinutes: true,
  ord: true,
  module: { select: { title: true, ord: true, track: { select: { slug: true, title: true, ord: true } } } },
} satisfies Prisma.LessonSelect;

/**
 * Lessons that teach what a question needs: those listing it in
 * `related_question_slugs`, else those on the question's main topic.
 */
export async function getRelatedLessons(questionSlug: string, userId?: string | null, limit = 4): Promise<RelatedLesson[]> {
  let direct = true;
  let lessons = await prisma.lesson.findMany({ where: { relatedQuestionSlugs: { has: questionSlug } }, select: relatedSelect });
  if (lessons.length === 0) {
    direct = false;
    const q = await prisma.question.findFirst({
      where: { slug: questionSlug, status: 'published' },
      select: { topics: { orderBy: { weight: 'desc' }, take: 1, select: { topicId: true } } },
    });
    const topicId = q?.topics[0]?.topicId;
    lessons = topicId ? await prisma.lesson.findMany({ where: { topicId }, select: relatedSelect }) : [];
  }
  lessons.sort(
    (a, b) => a.module.track.ord - b.module.track.ord || a.module.ord - b.module.ord || a.ord - b.ord
  );
  lessons = lessons.slice(0, limit);
  const done = new Set<string>();
  if (userId && lessons.length) {
    const rows = await prisma.lessonProgress.findMany({
      where: { userId, status: 'completed', lessonId: { in: lessons.map((l) => l.id) } },
      select: { lessonId: true },
    });
    for (const r of rows) done.add(r.lessonId);
  }
  return lessons.map((l) => ({
    href: `/learn/${l.module.track.slug}/${l.slug}`,
    title: l.title,
    estMinutes: l.estMinutes,
    trackTitle: l.module.track.title,
    moduleTitle: l.module.title,
    completed: done.has(l.id),
    direct,
  }));
}

/** The lesson id for a (track, lesson) slug pair — used by the server actions. */
export async function findLessonId(trackSlug: string, lessonSlug: string): Promise<string | null> {
  const l = await prisma.lesson.findFirst({
    where: { slug: lessonSlug, module: { track: { slug: trackSlug } } },
    select: { id: true },
  });
  return l?.id ?? null;
}

/** The module id for a (track, module) slug pair. */
export async function findModuleId(trackSlug: string, moduleSlug: string): Promise<string | null> {
  const m = await prisma.learnModule.findFirst({ where: { slug: moduleSlug, track: { slug: trackSlug } }, select: { id: true } });
  return m?.id ?? null;
}
