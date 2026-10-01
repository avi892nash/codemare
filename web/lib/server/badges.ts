import 'server-only';
import type { BadgeCriteria, BadgeRarity, Difficulty } from '@/lib/types';
import { prisma, type Db } from './db';
import { STAT_FOR_CRITERIA, criteriaMet, longestStreak, type BadgeStatKey, type BadgeStats } from './rules/badges';
import { badgeCriteriaSchema } from './schemas';

/**
 * Badges (spec §3.7). `evaluateBadges` runs after: accepted submit, unlock,
 * gate finish, lesson complete, checkpoint pass (the services for those
 * events call it and return what it awarded). Awards are idempotent (unique
 * (user_id, badge_id)) and never revoked.
 */

export interface AwardedBadge {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  rarity: BadgeRarity;
}

export interface BadgeWithStatus extends AwardedBadge {
  criteria: BadgeCriteria | null;
  awardedAt: Date | null;
}

/** Kinds of submission that count as a "solve". */
const SOLVE_KINDS = ['submit', 'gate'] as const;

function parseCriteria(slug: string, raw: unknown): BadgeCriteria | null {
  const r = badgeCriteriaSchema.safeParse(raw);
  if (!r.success) {
    const why = r.error.issues.map((i) => `${i.path.join('.') || 'criteria'}: ${i.message}`).join('; ');
    console.warn(`[badges] ignoring badge "${slug}": invalid criteria (${why})`);
    return null;
  }
  return r.data;
}

type Solve = { questionId: string; difficulty: Difficulty; firstSolvedAt: Date };
/** Per-evaluation context: memoizes the solves query several stats share. */
interface StatCtx {
  userId: string;
  db: Db;
  solves: () => Promise<Solve[]>;
}
type StatLoader = (ctx: StatCtx) => Promise<Partial<BadgeStats>>;

/** First accepted solve per question, with the question's difficulty. */
async function loadSolves(userId: string, db: Db): Promise<Solve[]> {
  const groups = await db.submission.groupBy({
    by: ['questionId'],
    where: { userId, status: 'OK', kind: { in: [...SOLVE_KINDS] }, questionId: { not: null } },
    _min: { createdAt: true },
  });
  const ids = groups.map((g) => g.questionId!).filter(Boolean);
  const questions = ids.length
    ? await db.question.findMany({ where: { id: { in: ids } }, select: { id: true, difficulty: true } })
    : [];
  const difficulty = new Map(questions.map((q) => [q.id, q.difficulty]));
  return groups
    .filter((g) => g.questionId && difficulty.has(g.questionId))
    .map((g) => ({
      questionId: g.questionId!,
      difficulty: difficulty.get(g.questionId!)!,
      firstSolvedAt: g._min.createdAt!,
    }));
}

const loaders: Record<BadgeStatKey, StatLoader> = {
  async solveCount({ solves }) {
    return { solveCount: (await solves()).length };
  },
  async solvesByDifficulty({ solves }) {
    const by: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
    for (const s of await solves()) by[s.difficulty]++;
    return { solvesByDifficulty: by };
  },
  async longestStreak({ userId, db }) {
    const rows = await db.$queryRaw<{ day: string }[]>`
      SELECT DISTINCT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
      FROM "app"."submissions"
      WHERE user_id = ${userId} AND status = 'OK' AND kind IN ('submit', 'gate')`;
    return { longestStreak: longestStreak(rows.map((r) => r.day)) };
  },
  async noHintSolves({ userId, db, solves: loadAll }) {
    const solves = await loadAll();
    if (solves.length === 0) return { noHintSolves: 0 };
    const uses = await db.hintUse.findMany({
      where: { userId, questionId: { in: solves.map((s) => s.questionId) } },
      select: { questionId: true, createdAt: true },
    });
    const n = solves.filter(
      (s) => !uses.some((u) => u.questionId === s.questionId && u.createdAt < s.firstSolvedAt)
    ).length;
    return { noHintSolves: n };
  },
  async topicsUnlocked({ userId, db }) {
    return { topicsUnlocked: await db.unlock.count({ where: { userId, kind: 'topic' } }) };
  },
  async openTierOrds({ userId, db }) {
    const opened = await db.unlock.findMany({ where: { userId, kind: 'tier' }, select: { refId: true } });
    const tiers = await db.tier.findMany({
      where: { OR: [{ ord: 0 }, { id: { in: opened.map((o) => o.refId) } }] },
      select: { ord: true },
    });
    return { openTierOrds: tiers.map((t) => t.ord) };
  },
  async gateFirstTry({ userId, db }) {
    const attempts = await db.gateAttempt.findMany({
      where: { userId },
      orderBy: { startedAt: 'asc' },
      select: { gateId: true, passed: true },
    });
    const first = new Map<string, boolean | null>();
    for (const a of attempts) if (!first.has(a.gateId)) first.set(a.gateId, a.passed);
    return { gateFirstTry: [...first.values()].some((p) => p === true) };
  },
  async lessonsCompleted({ userId, db }) {
    return { lessonsCompleted: await db.lessonProgress.count({ where: { userId, status: 'completed' } }) };
  },
  async tracksCompleted({ userId, db }) {
    const [tracks, done, passed] = await Promise.all([
      db.track.findMany({
        select: {
          modules: {
            select: { id: true, lessons: { select: { id: true } }, _count: { select: { checkpointQuestions: true } } },
          },
        },
      }),
      db.lessonProgress.findMany({ where: { userId, status: 'completed' }, select: { lessonId: true } }),
      db.checkpointAttempt.findMany({
        where: { userId, passed: true },
        distinct: ['moduleId'],
        select: { moduleId: true },
      }),
    ]);
    const doneIds = new Set(done.map((d) => d.lessonId));
    const passedModules = new Set(passed.map((p) => p.moduleId));
    const complete = tracks.filter((t) => {
      const lessons = t.modules.flatMap((m) => m.lessons);
      return (
        lessons.length > 0 &&
        lessons.every((l) => doneIds.has(l.id)) &&
        t.modules.every((m) => m._count.checkpointQuestions === 0 || passedModules.has(m.id))
      );
    });
    return { tracksCompleted: complete.length };
  },
  async bestPercentile({ userId, db }) {
    const r = await db.submission.aggregate({
      where: { userId, kind: 'submit', status: 'OK', percentile: { not: null } },
      _max: { percentile: true },
    });
    return { bestPercentile: r._max.percentile ?? null };
  },
};

/**
 * Award every badge whose criteria now hold. Returns only the badges newly
 * awarded by this call (so callers can announce them).
 */
export async function evaluateBadges(userId: string, db: Db = prisma): Promise<AwardedBadge[]> {
  const [badges, awarded] = await Promise.all([
    db.badge.findMany({ orderBy: { ord: 'asc' } }),
    db.badgeAward.findMany({ where: { userId }, select: { badgeId: true } }),
  ]);
  const have = new Set(awarded.map((a) => a.badgeId));
  const pending = badges
    .filter((b) => !have.has(b.id))
    .map((b) => ({ badge: b, criteria: parseCriteria(b.slug, b.criteria) }))
    .filter((p): p is { badge: (typeof badges)[number]; criteria: BadgeCriteria } => p.criteria !== null);
  if (pending.length === 0) return [];

  const needed = new Set(pending.map((p) => STAT_FOR_CRITERIA[p.criteria.kind]));
  let solves: Promise<Solve[]> | undefined;
  const ctx: StatCtx = { userId, db, solves: () => (solves ??= loadSolves(userId, db)) };
  const stats: Partial<BadgeStats> = {};
  for (const part of await Promise.all([...needed].map((k) => loaders[k](ctx)))) {
    Object.assign(stats, part);
  }

  const out: AwardedBadge[] = [];
  for (const { badge, criteria } of pending) {
    if (!criteriaMet(criteria, stats)) continue;
    const { count } = await db.badgeAward.createMany({
      data: [{ userId, badgeId: badge.id }],
      skipDuplicates: true,
    });
    if (count === 1) {
      out.push({
        id: badge.id,
        slug: badge.slug,
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        rarity: badge.rarity,
      });
    }
  }
  return out;
}

/** Every badge with the user's award time (null = not earned), in display order. */
export async function getBadgeGallery(userId: string, db: Db = prisma): Promise<BadgeWithStatus[]> {
  const [badges, awards] = await Promise.all([
    db.badge.findMany({ orderBy: { ord: 'asc' } }),
    db.badgeAward.findMany({ where: { userId }, select: { badgeId: true, awardedAt: true } }),
  ]);
  const at = new Map(awards.map((a) => [a.badgeId, a.awardedAt]));
  return badges.map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    icon: b.icon,
    rarity: b.rarity,
    criteria: parseCriteria(b.slug, b.criteria),
    awardedAt: at.get(b.id) ?? null,
  }));
}
