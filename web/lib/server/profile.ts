import 'server-only';
import type { BadgeCriteria, BadgeRarity, Difficulty, Role, SubmissionKind, SubmissionStatus, SupportedLanguage } from '@/lib/types';
import { prisma } from './db';
import { getBadgeGallery } from './badges';
import { getTopicBalances, type TopicBalance } from './ledger';
import { acceptanceRate, badgeProgress, buildHeatmap, currentStreak, describeCriteria, longestStreak, utcDay, type BadgeProgress, type BadgeProgressStats, type Heatmap } from './rules/activity';
import { trackProgress, type CheckpointAttemptRow, type LessonProgressRow } from './rules/learnProgress';

/**
 * Public profile (/u/[handle], artboard 06) and the badge gallery (B1–B3).
 * Any signed-in user may view any profile, so nothing private is exposed:
 * no email, no code, no hidden-test data. Solve semantics match the badge
 * rules: a solve is an accepted `submit` or `gate` submission of a question.
 */

const SOLVE_KINDS = ['submit', 'gate'] as const;
const DAY_MS = 86_400_000;

export interface ProfileUser {
  id: string;
  handle: string;
  name: string;
  image: string | null;
  role: Role;
  joinedAt: Date;
}

/** A user by handle (case-insensitive), or null. */
export async function findProfileUser(handle: string): Promise<ProfileUser | null> {
  const h = handle.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(h)) return null;
  const u = await prisma.user.findUnique({
    where: { handle: h },
    select: { id: true, handle: true, name: true, image: true, role: true, createdAt: true },
  });
  return u ? { id: u.id, handle: u.handle, name: u.name?.trim() || u.handle, image: u.image, role: u.role, joinedAt: u.createdAt } : null;
}

// ─── Stats ───────────────────────────────────────────────────────────────

interface Solve {
  questionId: string;
  difficulty: Difficulty;
  firstSolvedAt: Date;
}

async function loadSolves(userId: string): Promise<Solve[]> {
  const groups = await prisma.submission.groupBy({
    by: ['questionId'],
    where: { userId, status: 'OK', kind: { in: [...SOLVE_KINDS] }, questionId: { not: null } },
    _min: { createdAt: true },
  });
  const ids = groups.map((g) => g.questionId).filter((id): id is string => !!id);
  if (ids.length === 0) return [];
  const qs = await prisma.question.findMany({ where: { id: { in: ids } }, select: { id: true, difficulty: true } });
  const diff = new Map(qs.map((q) => [q.id, q.difficulty]));
  return groups
    .filter((g) => g.questionId && diff.has(g.questionId))
    .map((g) => ({ questionId: g.questionId!, difficulty: diff.get(g.questionId!)!, firstSolvedAt: g._min.createdAt! }));
}

/** Distinct UTC days with an accepted solve (streak days). */
async function loadSolveDays(userId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ day: string }[]>`
    SELECT DISTINCT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
    FROM "app"."submissions"
    WHERE user_id = ${userId} AND status = 'OK' AND kind IN ('submit', 'gate')`;
  return rows.map((r) => r.day);
}

/** Submissions per UTC day since `from` (any kind — the activity heatmap). */
async function loadActivity(userId: string, from: Date): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ day: string; n: bigint }[]>`
    SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*) AS n
    FROM "app"."submissions"
    WHERE user_id = ${userId} AND created_at >= ${from}
    GROUP BY 1`;
  return new Map(rows.map((r) => [r.day, Number(r.n)]));
}

async function loadLearnProgress(userId: string) {
  const [tracks, rows, attempts] = await Promise.all([
    prisma.track.findMany({
      orderBy: { ord: 'asc' },
      select: {
        slug: true,
        title: true,
        level: true,
        modules: {
          orderBy: { ord: 'asc' },
          select: {
            id: true,
            slug: true,
            title: true,
            lessons: { orderBy: { ord: 'asc' }, select: { id: true, slug: true, title: true, estMinutes: true } },
            _count: { select: { checkpointQuestions: true } },
          },
        },
      },
    }),
    prisma.lessonProgress.findMany({
      where: { userId },
      select: { lessonId: true, status: true, startedAt: true, completedAt: true },
    }),
    prisma.checkpointAttempt.findMany({
      where: { userId },
      select: { moduleId: true, score: true, total: true, passed: true, createdAt: true },
    }),
  ]);
  const lessonMap = new Map<string, LessonProgressRow>(rows.map((r) => [r.lessonId, r]));
  const byModule = new Map<string, CheckpointAttemptRow[]>();
  for (const a of attempts) byModule.set(a.moduleId, [...(byModule.get(a.moduleId) ?? []), a]);
  return tracks.map((t) => {
    const shape = { slug: t.slug, modules: t.modules.map((m) => ({ ...m, checkpointCount: m._count.checkpointQuestions })) };
    const p = trackProgress(shape, lessonMap, byModule);
    return {
      slug: t.slug,
      title: t.title,
      level: t.level,
      lessonsDone: p.lessonsDone,
      lessonsTotal: p.lessonsTotal,
      checkpointsPassed: p.checkpointsPassed,
      checkpointsTotal: p.checkpointsTotal,
      percent: p.percent,
      complete: p.complete,
      started: p.started,
    };
  });
}

export type LearnTrackSummary = Awaited<ReturnType<typeof loadLearnProgress>>[number];

/** Every stat a badge criterion can be measured against (see rules/badges.ts). */
export async function loadBadgeStats(userId: string): Promise<BadgeProgressStats> {
  const [solves, days, uses, topicsUnlocked, tierUnlocks, gateAttempts, lessonsCompleted, learn, best] = await Promise.all([
    loadSolves(userId),
    loadSolveDays(userId),
    prisma.hintUse.findMany({ where: { userId }, select: { questionId: true, createdAt: true } }),
    prisma.unlock.count({ where: { userId, kind: 'topic' } }),
    prisma.unlock.findMany({ where: { userId, kind: 'tier' }, select: { refId: true } }),
    prisma.gateAttempt.findMany({ where: { userId }, orderBy: { startedAt: 'asc' }, select: { gateId: true, passed: true } }),
    prisma.lessonProgress.count({ where: { userId, status: 'completed' } }),
    loadLearnProgress(userId),
    prisma.submission.aggregate({ where: { userId, kind: 'submit', status: 'OK', percentile: { not: null } }, _max: { percentile: true } }),
  ]);
  const tiers = await prisma.tier.findMany({
    where: { OR: [{ ord: 0 }, { id: { in: tierUnlocks.map((u) => u.refId) } }] },
    select: { ord: true },
  });
  const byDifficulty: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  for (const s of solves) byDifficulty[s.difficulty]++;
  const firstAttempt = new Map<string, boolean | null>();
  for (const a of gateAttempts) if (!firstAttempt.has(a.gateId)) firstAttempt.set(a.gateId, a.passed);
  const noHint = solves.filter((s) => !uses.some((u) => u.questionId === s.questionId && u.createdAt < s.firstSolvedAt)).length;
  const fractions = learn.map((t) => {
    const units = t.lessonsTotal + t.checkpointsTotal;
    return units ? (t.lessonsDone + t.checkpointsPassed) / units : 0;
  });
  return {
    solveCount: solves.length,
    solvesByDifficulty: byDifficulty,
    longestStreak: longestStreak(days),
    noHintSolves: noHint,
    topicsUnlocked,
    openTierOrds: tiers.map((t) => t.ord),
    gateFirstTry: [...firstAttempt.values()].some((p) => p === true),
    lessonsCompleted,
    tracksCompleted: learn.filter((t) => t.complete).length,
    bestPercentile: best._max.percentile ?? null,
    bestTrackFraction: Math.max(0, ...fractions),
  };
}

// ─── Profile (06) ────────────────────────────────────────────────────────

export interface RecentSubmission {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  language: SupportedLanguage;
  runtimeUs: number | null;
  createdAt: Date;
  /** The question that was run (null once it is unpublished or deleted). */
  target: { kind: 'question'; slug: string; title: string; difficulty: Difficulty } | null;
}

export interface EarnedBadge {
  slug: string;
  name: string;
  icon: string;
  rarity: BadgeRarity;
  awardedAt: Date;
}

export interface ProfileView {
  user: ProfileUser;
  isOwner: boolean;
  solved: { total: number; byDifficulty: Record<Difficulty, number>; published: Record<Difficulty, number> };
  acceptance: { accepted: number; judged: number; rate: number | null };
  fastest: { runtimeUs: number; language: SupportedLanguage; question: { slug: string; title: string } } | null;
  streak: { current: number; longest: number };
  tokens: { topics: TopicBalance[]; total: number };
  activity: Heatmap;
  badges: { earned: EarnedBadge[]; total: number };
  recent: RecentSubmission[];
  learn: LearnTrackSummary[];
}

const JUDGED: SubmissionStatus[] = ['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE'];

/** The activity map is shown from this many active days; before that a lone filled square says nothing. */
export const HEATMAP_MIN_ACTIVE_DAYS = 7;

/**
 * Which blocks of the profile have anything to say. A block with nothing in it
 * is not drawn: no stats until something is solved, no activity map before a
 * week of it, no tokens or learn card while those are empty (Recent
 * submissions and Badges always are — their empty line is the nudge).
 */
export function profileSections(view: {
  solved: { total: number };
  activity: { activeDays: number };
  tokens: { topics: readonly unknown[] };
  learn: readonly { started: boolean }[];
}) {
  return {
    stats: view.solved.total > 0,
    activity: view.activity.activeDays >= HEATMAP_MIN_ACTIVE_DAYS,
    tokens: view.tokens.topics.length > 0,
    learn: view.learn.some((t) => t.started),
  };
}

export async function getProfile(handle: string, viewerId: string | null, now = new Date()): Promise<ProfileView | null> {
  const user = await findProfileUser(handle);
  if (!user) return null;
  const userId = user.id;
  const today = utcDay(now);
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * DAY_MS);

  const [solves, published, verdicts, fastest, days, activity, tokens, gallery, recent, learn] = await Promise.all([
    loadSolves(userId),
    prisma.question.groupBy({ by: ['difficulty'], where: { status: 'published' }, _count: { _all: true } }),
    prisma.submission.groupBy({
      by: ['status'],
      where: { userId, kind: { in: [...SOLVE_KINDS] }, status: { in: JUDGED } },
      _count: { _all: true },
    }),
    prisma.submission.findFirst({
      where: { userId, kind: 'submit', status: 'OK', runtimeUs: { not: null }, question: { status: 'published' } },
      orderBy: [{ runtimeUs: 'asc' }, { createdAt: 'asc' }],
      select: { runtimeUs: true, language: true, question: { select: { slug: true, title: true } } },
    }),
    loadSolveDays(userId),
    loadActivity(userId, from),
    getTopicBalances(userId),
    getBadgeGallery(userId),
    prisma.submission.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        kind: true,
        status: true,
        language: true,
        runtimeUs: true,
        createdAt: true,
        question: { select: { slug: true, title: true, difficulty: true, status: true } },
      },
    }),
    loadLearnProgress(userId),
  ]);

  const byDifficulty: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  for (const s of solves) byDifficulty[s.difficulty]++;
  const publishedCounts: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
  for (const c of published) publishedCounts[c.difficulty] = c._count._all;
  const judged = verdicts.reduce((n, v) => n + v._count._all, 0);
  const accepted = verdicts.find((v) => v.status === 'OK')?._count._all ?? 0;

  const earned = gallery
    .filter((b) => b.awardedAt)
    .sort((a, b) => b.awardedAt!.getTime() - a.awardedAt!.getTime())
    .map((b) => ({ slug: b.slug, name: b.name, icon: b.icon, rarity: b.rarity, awardedAt: b.awardedAt! }));

  return {
    user,
    isOwner: viewerId === userId,
    solved: { total: solves.length, byDifficulty, published: publishedCounts },
    acceptance: { accepted, judged, rate: acceptanceRate(accepted, judged) },
    fastest:
      fastest && fastest.question && fastest.runtimeUs !== null
        ? { runtimeUs: Number(fastest.runtimeUs), language: fastest.language, question: fastest.question }
        : null,
    streak: { current: currentStreak(days, today), longest: longestStreak(days) },
    tokens: { topics: tokens.filter((t) => t.total > 0), total: tokens.reduce((n, t) => n + t.total, 0) },
    activity: buildHeatmap(activity, today),
    badges: { earned, total: gallery.length },
    recent: recent.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      language: r.language,
      runtimeUs: r.runtimeUs === null ? null : Number(r.runtimeUs),
      createdAt: r.createdAt,
      target:
        r.question && r.question.status === 'published'
          ? { kind: 'question', slug: r.question.slug, title: r.question.title, difficulty: r.question.difficulty }
          : null,
    })),
    learn,
  };
}

// ─── Badge gallery (B1–B3) ───────────────────────────────────────────────

export interface GalleryBadge {
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: BadgeRarity;
  criteria: BadgeCriteria | null;
  /** "How to earn" sentence. */
  howTo: string;
  awardedAt: Date | null;
  progress: BadgeProgress | null;
  /** Share of all users holding it, whole percent (null when no users). */
  heldByPercent: number | null;
}

export interface BadgeGalleryView {
  user: ProfileUser;
  isOwner: boolean;
  badges: GalleryBadge[];
  earned: number;
}

export async function getBadgeGalleryView(handle: string, viewerId: string | null): Promise<BadgeGalleryView | null> {
  const user = await findProfileUser(handle);
  if (!user) return null;
  const [gallery, stats, holders, users] = await Promise.all([
    getBadgeGallery(user.id),
    loadBadgeStats(user.id),
    prisma.badgeAward.groupBy({ by: ['badgeId'], _count: { _all: true } }),
    prisma.user.count(),
  ]);
  const held = new Map(holders.map((h) => [h.badgeId, h._count._all]));
  const badges = gallery.map((b) => ({
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    rarity: b.rarity,
    criteria: b.criteria,
    howTo: b.criteria ? describeCriteria(b.criteria) : b.description,
    awardedAt: b.awardedAt,
    progress: b.criteria ? badgeProgress(b.criteria, stats) : null,
    heldByPercent: users > 0 ? Math.round(((held.get(b.id) ?? 0) / users) * 100) : null,
  }));
  return { user, isOwner: viewerId === user.id, badges, earned: badges.filter((b) => b.awardedAt).length };
}
