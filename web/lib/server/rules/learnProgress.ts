/**
 * Pure learn-progress rules: per-lesson / per-module / per-track state, the
 * learning sequence (lessons, then the module's checkpoint), neighbors for
 * prev/next, and "continue where you left off". No DB, no server-only.
 *
 * A track is complete when every lesson is completed and every module that
 * has checkpoint questions has a passed attempt — the same rule as the
 * `track_completed` badge (rules/badges.ts).
 */

export type LessonState = 'not_started' | 'started' | 'completed';

export interface LessonShape {
  id: string;
  slug: string;
  title: string;
  estMinutes: number;
}

export interface ModuleShape {
  id: string;
  slug: string;
  title: string;
  lessons: LessonShape[];
  /** Number of checkpoint questions (0 = the module has no checkpoint). */
  checkpointCount: number;
}

export interface TrackShape {
  slug: string;
  modules: ModuleShape[];
}

export interface LessonProgressRow {
  lessonId: string;
  status: 'started' | 'completed';
  startedAt: Date;
  completedAt: Date | null;
}

export interface CheckpointAttemptRow {
  moduleId: string;
  score: number;
  total: number;
  passed: boolean;
  createdAt: Date;
}

export interface CheckpointSummary {
  questions: number;
  attempts: number;
  passed: boolean;
  /** Best attempt by score ratio (ties → earliest). */
  best: { score: number; total: number } | null;
  lastAttemptAt: Date | null;
  /** First passing attempt. */
  passedAt: Date | null;
}

export interface LessonProgressView {
  lesson: LessonShape;
  state: LessonState;
  completedAt: Date | null;
}

export interface ModuleProgress {
  moduleId: string;
  lessons: LessonProgressView[];
  lessonsDone: number;
  /** null when the module has no checkpoint. */
  checkpoint: CheckpointSummary | null;
  complete: boolean;
}

export type LearnStep =
  | { kind: 'lesson'; moduleSlug: string; moduleTitle: string; lessonSlug: string; title: string; estMinutes: number }
  | { kind: 'checkpoint'; moduleSlug: string; moduleTitle: string; title: string; questions: number };

export interface TrackProgress {
  modules: ModuleProgress[];
  lessonsDone: number;
  lessonsTotal: number;
  checkpointsPassed: number;
  checkpointsTotal: number;
  /** Whole percent of lessons + checkpoints done; 100 only when complete. */
  percent: number;
  complete: boolean;
  started: boolean;
  /** First unfinished step in learning order (null when complete). */
  next: LearnStep | null;
  /**
   * The lesson the learner opened last, when it is still unfinished and
   * nothing happened in the track after opening it — "where you left off".
   */
  resume: LearnStep | null;
  lastActivityAt: Date | null;
  /** When the last requirement was met (null unless complete). */
  completedAt: Date | null;
  /** Sum of lesson estimates. */
  estMinutes: number;
}

const maxDate = (dates: Array<Date | null | undefined>): Date | null =>
  dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);

export function summarizeCheckpoint(questions: number, attempts: readonly CheckpointAttemptRow[]): CheckpointSummary {
  const sorted = [...attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let best: CheckpointAttemptRow | null = null;
  for (const a of sorted) {
    const ratio = a.total > 0 ? a.score / a.total : 0;
    const bestRatio = best && best.total > 0 ? best.score / best.total : -1;
    if (ratio > bestRatio) best = a;
  }
  const firstPass = sorted.find((a) => a.passed) ?? null;
  return {
    questions,
    attempts: sorted.length,
    passed: firstPass !== null,
    best: best ? { score: best.score, total: best.total } : null,
    lastAttemptAt: sorted.at(-1)?.createdAt ?? null,
    passedAt: firstPass?.createdAt ?? null,
  };
}

/** Lessons then (if any) the checkpoint, module by module. */
export function learnSequence(track: TrackShape): LearnStep[] {
  const out: LearnStep[] = [];
  for (const m of track.modules) {
    for (const l of m.lessons) {
      out.push({ kind: 'lesson', moduleSlug: m.slug, moduleTitle: m.title, lessonSlug: l.slug, title: l.title, estMinutes: l.estMinutes });
    }
    if (m.checkpointCount > 0) {
      out.push({ kind: 'checkpoint', moduleSlug: m.slug, moduleTitle: m.title, title: `${m.title} checkpoint`, questions: m.checkpointCount });
    }
  }
  return out;
}

const sameStep = (a: LearnStep, b: { kind: LearnStep['kind']; moduleSlug: string; lessonSlug?: string }) =>
  a.kind === b.kind && a.moduleSlug === b.moduleSlug && (a.kind === 'checkpoint' || a.lessonSlug === b.lessonSlug);

/** The steps before and after `at` in learning order. */
export function neighbors(
  track: TrackShape,
  at: { kind: 'lesson'; moduleSlug: string; lessonSlug: string } | { kind: 'checkpoint'; moduleSlug: string }
): { prev: LearnStep | null; next: LearnStep | null } {
  const seq = learnSequence(track);
  const i = seq.findIndex((s) => sameStep(s, at));
  if (i < 0) return { prev: null, next: null };
  return { prev: seq[i - 1] ?? null, next: seq[i + 1] ?? null };
}

export function trackProgress(
  track: TrackShape,
  lessonRows: ReadonlyMap<string, LessonProgressRow>,
  attemptsByModule: ReadonlyMap<string, readonly CheckpointAttemptRow[]>
): TrackProgress {
  let lessonsDone = 0;
  let lessonsTotal = 0;
  let checkpointsPassed = 0;
  let checkpointsTotal = 0;
  let estMinutes = 0;
  const activity: Array<Date | null> = [];
  const completions: Array<Date | null> = [];
  const modules: ModuleProgress[] = [];

  for (const m of track.modules) {
    const lessons: LessonProgressView[] = [];
    for (const lesson of m.lessons) {
      const row = lessonRows.get(lesson.id);
      const state: LessonState = row ? (row.status === 'completed' ? 'completed' : 'started') : 'not_started';
      activity.push(row?.startedAt ?? null, row?.completedAt ?? null);
      completions.push(row?.completedAt ?? null);
      estMinutes += lesson.estMinutes;
      lessons.push({ lesson, state, completedAt: row?.completedAt ?? null });
    }
    const done = lessons.filter((l) => l.state === 'completed').length;
    lessonsDone += done;
    lessonsTotal += lessons.length;

    let checkpoint: CheckpointSummary | null = null;
    if (m.checkpointCount > 0) {
      checkpoint = summarizeCheckpoint(m.checkpointCount, attemptsByModule.get(m.id) ?? []);
      checkpointsTotal++;
      if (checkpoint.passed) checkpointsPassed++;
      activity.push(checkpoint.lastAttemptAt);
      completions.push(checkpoint.passedAt);
    }
    const complete = done === lessons.length && (checkpoint === null || checkpoint.passed);
    modules.push({ moduleId: m.id, lessons, lessonsDone: done, checkpoint, complete });
  }

  const complete = lessonsTotal > 0 && modules.every((m) => m.complete);
  // The first unfinished step in learning order.
  const lessonState = new Map(modules.flatMap((m) => m.lessons.map((l) => [l.lesson.slug, l.state] as const)));
  const passed = new Map(track.modules.map((m, k) => [m.slug, modules[k].checkpoint?.passed ?? true] as const));
  const next = complete
    ? null
    : (learnSequence(track).find((s) =>
        s.kind === 'lesson' ? lessonState.get(s.lessonSlug) !== 'completed' : !passed.get(s.moduleSlug)
      ) ?? null);

  const units = lessonsTotal + checkpointsTotal;
  const doneUnits = lessonsDone + checkpointsPassed;
  const lastActivityAt = maxDate(activity);
  let resume: LearnStep | null = null;
  if (!complete && lastActivityAt) {
    for (const [k, m] of track.modules.entries()) {
      const hit = modules[k].lessons.find((l) => l.state === 'started' && lessonRows.get(l.lesson.id)?.startedAt.getTime() === lastActivityAt.getTime());
      if (hit) {
        resume = { kind: 'lesson', moduleSlug: m.slug, moduleTitle: m.title, lessonSlug: hit.lesson.slug, title: hit.lesson.title, estMinutes: hit.lesson.estMinutes };
        break;
      }
    }
  }
  return {
    modules,
    lessonsDone,
    lessonsTotal,
    checkpointsPassed,
    checkpointsTotal,
    percent: complete ? 100 : units === 0 ? 0 : Math.min(99, Math.floor((doneUnits / units) * 100)),
    complete,
    started: lastActivityAt !== null,
    next,
    resume,
    lastActivityAt,
    completedAt: complete ? maxDate(completions) : null,
    estMinutes,
  };
}

/**
 * "Continue where you left off": the most recently active unfinished track
 * and its next step. If the most recent activity was in a track that is now
 * complete, the next unfinished track (in display order) that has been
 * started, else the first unstarted one. null when there is no activity.
 */
export function pickContinue<T extends { progress: TrackProgress }>(tracks: readonly T[]): { track: T; step: LearnStep } | null {
  const active = tracks.filter((t) => t.progress.started);
  if (active.length === 0) return null;
  const unfinished = active
    .filter((t) => !t.progress.complete && t.progress.next)
    .sort((a, b) => b.progress.lastActivityAt!.getTime() - a.progress.lastActivityAt!.getTime());
  if (unfinished.length > 0) return { track: unfinished[0], step: continueStep(unfinished[0].progress)! };
  const fresh = tracks.find((t) => !t.progress.complete && t.progress.next);
  return fresh ? { track: fresh, step: fresh.progress.next! } : null;
}

/** Where "continue" goes: the lesson left open, else the next step in order. */
export function continueStep(p: TrackProgress): LearnStep | null {
  return p.resume ?? p.next;
}

/** URL of a learning step inside a track. */
export function stepHref(trackSlug: string, step: LearnStep): string {
  return step.kind === 'lesson'
    ? `/learn/${trackSlug}/${step.lessonSlug}`
    : `/learn/${trackSlug}/${step.moduleSlug}/checkpoint`;
}
