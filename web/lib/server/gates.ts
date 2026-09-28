import 'server-only';
import { prisma, withUserLock, type Db, type Tx } from './db';
import { evaluateBadges, type AwardedBadge } from './badges';
import { AccessDenied, GateNotEligible, NotFoundError } from './errors';
import {
  cooldownEnd,
  gateDeadline,
  gateEligibility,
  isAttemptExpired,
  isAttemptRunning,
  isGatePassed,
} from './rules/gates';
import { getOpenTierIds } from './unlocks';

/**
 * Gates (spec §3.5). Passing tier N's gate opens tier N.
 *
 *   eligible  ⇔ tier N−1 open, no running attempt, cooldown over
 *   start     → attempt with deadline = now + time_limit_minutes
 *   finish    → explicit, or lazily on any read after the deadline;
 *               passed_count = gate questions with an accepted `gate`
 *               submission in the attempt; pass → unlock tier,
 *               fail → next_eligible_at = finished_at + cooldown_hours
 *
 * Every function takes an optional `now` (tests, consistent timestamps).
 */

export type GateState = 'passed' | 'eligible' | 'running' | 'cooldown' | 'previous_tier_closed';

export interface GateInfo {
  id: string;
  tierId: string;
  title: string;
  summary: string;
  passThreshold: number;
  cooldownHours: number;
  timeLimitMinutes: number;
  questionCount: number;
}

export interface GateAttemptSummary {
  id: string;
  gateId: string;
  startedAt: Date;
  deadlineAt: Date;
  finishedAt: Date | null;
  passedCount: number;
  passed: boolean | null;
  nextEligibleAt: Date | null;
}

export interface GateStatus {
  gate: GateInfo;
  tier: { id: string; ord: number; slug: string; title: string };
  state: GateState;
  /** Can start an attempt right now. */
  eligible: boolean;
  /** state = 'cooldown': when the gate can be retried. */
  nextEligibleAt: Date | null;
  runningAttempt: GateAttemptSummary | null;
  /** Latest finished attempt. */
  lastAttempt: GateAttemptSummary | null;
  attemptCount: number;
}

export interface GateFinishResult {
  attempt: GateAttemptSummary;
  passed: boolean;
  passedCount: number;
  passThreshold: number;
  /** This finish opened the tier. */
  tierUnlocked: boolean;
  nextEligibleAt: Date | null;
  badgesAwarded: AwardedBadge[];
}

export interface GateAttemptView {
  attempt: GateAttemptSummary;
  gate: GateInfo;
  running: boolean;
  /** Gate questions in order, with whether this attempt has an accepted submission. */
  questions: { questionId: string; slug: string; title: string; difficulty: string; ord: number; solved: boolean }[];
}

const attemptSelect = {
  id: true,
  gateId: true,
  startedAt: true,
  deadlineAt: true,
  finishedAt: true,
  passedCount: true,
  passed: true,
  nextEligibleAt: true,
} as const;

// ─── Finishing ───────────────────────────────────────────────────────────

/** Distinct gate questions with an accepted `gate` submission created by `until`. */
async function countPassed(db: Db, attemptId: string, gateId: string, until: Date): Promise<number> {
  const gateQuestions = await db.gateQuestion.findMany({ where: { gateId }, select: { questionId: true } });
  const rows = await db.submission.findMany({
    where: {
      gateAttemptId: attemptId,
      kind: 'gate',
      status: 'OK',
      createdAt: { lte: until },
      questionId: { in: gateQuestions.map((g) => g.questionId) },
    },
    distinct: ['questionId'],
    select: { questionId: true },
  });
  return rows.length;
}

/**
 * Finish one attempt inside a locked transaction. Idempotent: an already
 * finished attempt is returned untouched. A finish at/after the deadline is
 * stamped at the deadline.
 */
async function finishLocked(
  tx: Tx,
  attemptId: string,
  now: Date
): Promise<{ attempt: GateAttemptSummary; tierUnlocked: boolean; passThreshold: number; changed: boolean }> {
  const a = await tx.gateAttempt.findUnique({
    where: { id: attemptId },
    select: { ...attemptSelect, userId: true, gate: { select: { tierId: true, passThreshold: true, cooldownHours: true } } },
  });
  if (!a) throw new NotFoundError('gate attempt', attemptId);
  const { gate, userId, ...rest } = a;
  if (a.finishedAt) return { attempt: rest, tierUnlocked: false, passThreshold: gate.passThreshold, changed: false };

  const finishedAt = now.getTime() >= a.deadlineAt.getTime() ? a.deadlineAt : now;
  const passedCount = await countPassed(tx, a.id, a.gateId, finishedAt);
  const passed = isGatePassed(passedCount, gate.passThreshold);
  const attempt = await tx.gateAttempt.update({
    where: { id: a.id },
    data: {
      finishedAt,
      passedCount,
      passed,
      nextEligibleAt: passed ? null : cooldownEnd(finishedAt, gate.cooldownHours),
    },
    select: attemptSelect,
  });
  let tierUnlocked = false;
  if (passed) {
    const { count } = await tx.unlock.createMany({
      data: [{ userId, kind: 'tier', refId: gate.tierId }],
      skipDuplicates: true,
    });
    tierUnlocked = count === 1;
  }
  return { attempt, tierUnlocked, passThreshold: gate.passThreshold, changed: true };
}

/**
 * Lazily finish the user's attempts whose deadline has passed (optionally
 * for one gate). Returns the finish results (badges evaluated if any).
 */
export async function finishExpiredAttempts(
  userId: string,
  opts: { gateId?: string; now?: Date } = {}
): Promise<GateFinishResult[]> {
  const now = opts.now ?? new Date();
  const expired = await prisma.gateAttempt.findMany({
    where: { userId, finishedAt: null, deadlineAt: { lte: now }, ...(opts.gateId ? { gateId: opts.gateId } : {}) },
    select: { id: true },
  });
  const out: GateFinishResult[] = [];
  for (const { id } of expired) out.push(await finishGate(userId, id, now));
  return out;
}

/**
 * Finish an attempt now (explicit "submit gate"), or at its deadline when
 * that has passed. Idempotent. Pass opens the tier; badges are evaluated.
 */
export async function finishGate(userId: string, attemptId: string, now: Date = new Date()): Promise<GateFinishResult> {
  const owner = await prisma.gateAttempt.findUnique({ where: { id: attemptId }, select: { userId: true } });
  if (!owner || owner.userId !== userId) throw new NotFoundError('gate attempt', attemptId);

  const r = await withUserLock(userId, (tx) => finishLocked(tx, attemptId, now));
  const badgesAwarded = r.changed ? await evaluateBadges(userId) : [];
  return {
    attempt: r.attempt,
    passed: r.attempt.passed === true,
    passedCount: r.attempt.passedCount,
    passThreshold: r.passThreshold,
    tierUnlocked: r.tierUnlocked,
    nextEligibleAt: r.attempt.nextEligibleAt,
    badgesAwarded,
  };
}

// ─── Status ──────────────────────────────────────────────────────────────

/**
 * Status of every gate for the user, keyed by gate id. Reads are lazy
 * finishers: expired attempts are finished first. Pass `tx` (inside the
 * user's lock) to skip the lazy finish and read within a transaction.
 */
export async function getGateStatuses(
  userId: string,
  opts: { now?: Date; tx?: Tx } = {}
): Promise<Map<string, GateStatus>> {
  const now = opts.now ?? new Date();
  if (!opts.tx) await finishExpiredAttempts(userId, { now });
  const db: Db = opts.tx ?? prisma;

  const [tiers, openTierIds, attempts] = await Promise.all([
    db.tier.findMany({
      orderBy: { ord: 'asc' },
      select: {
        id: true,
        ord: true,
        slug: true,
        title: true,
        gate: {
          select: {
            id: true,
            tierId: true,
            title: true,
            summary: true,
            passThreshold: true,
            cooldownHours: true,
            timeLimitMinutes: true,
            _count: { select: { questions: true } },
          },
        },
      },
    }),
    getOpenTierIds(userId, db),
    db.gateAttempt.findMany({ where: { userId }, orderBy: { startedAt: 'desc' }, select: attemptSelect }),
  ]);

  const out = new Map<string, GateStatus>();
  tiers.forEach((tier, i) => {
    if (!tier.gate) return;
    const { _count, ...g } = tier.gate;
    const gate: GateInfo = { ...g, questionCount: _count.questions };
    const mine = attempts.filter((a) => a.gateId === gate.id);
    const running = mine.find((a) => isAttemptRunning(a, now)) ?? null;
    const lastFinished =
      mine
        .filter((a) => a.finishedAt)
        .sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime())[0] ?? null;
    const tierOpen = openTierIds.has(tier.id);
    // Tier N−1 = the tier just below by ord (tier 0 has no gate).
    const previousTierOpen = i === 0 ? true : openTierIds.has(tiers[i - 1].id);
    const cooldownUntil = lastFinished && lastFinished.passed === false ? lastFinished.nextEligibleAt : null;
    const e = gateEligibility({ tierOpen, previousTierOpen, hasRunningAttempt: running !== null, cooldownUntil, now });
    const state: GateState = e.eligible
      ? 'eligible'
      : e.reason === 'already_open'
        ? 'passed'
        : e.reason === 'running'
          ? 'running'
          : e.reason;
    out.set(gate.id, {
      gate,
      tier: { id: tier.id, ord: tier.ord, slug: tier.slug, title: tier.title },
      state,
      eligible: e.eligible,
      nextEligibleAt: e.eligible ? null : e.nextEligibleAt,
      runningAttempt: running,
      lastAttempt: lastFinished,
      attemptCount: mine.length,
    });
  });
  return out;
}

/** Status of one gate (lazily finishing an expired attempt first). */
export async function getGateStatus(userId: string, gateId: string, now: Date = new Date()): Promise<GateStatus> {
  const status = (await getGateStatuses(userId, { now })).get(gateId);
  if (!status) throw new NotFoundError('gate', gateId);
  return status;
}

// ─── Attempts ────────────────────────────────────────────────────────────

/** Start an attempt. Throws GateNotEligible (with reason / next eligible time). */
export async function startGate(userId: string, gateId: string, now: Date = new Date()): Promise<GateAttemptSummary> {
  await finishExpiredAttempts(userId, { gateId, now });
  return withUserLock(userId, async (tx) => {
    const status = (await getGateStatuses(userId, { now, tx })).get(gateId);
    if (!status) throw new NotFoundError('gate', gateId);
    if (status.state !== 'eligible') {
      throw new GateNotEligible(status.state === 'passed' ? 'already_open' : status.state, status.nextEligibleAt);
    }
    return tx.gateAttempt.create({
      data: { userId, gateId, startedAt: now, deadlineAt: gateDeadline(now, status.gate.timeLimitMinutes) },
      select: attemptSelect,
    });
  });
}

/** An attempt with its questions and per-question progress (lazily finished if expired). */
export async function getGateAttempt(userId: string, attemptId: string, now: Date = new Date()): Promise<GateAttemptView> {
  const row = await prisma.gateAttempt.findUnique({ where: { id: attemptId }, select: { userId: true, deadlineAt: true, finishedAt: true } });
  if (!row || row.userId !== userId) throw new NotFoundError('gate attempt', attemptId);
  if (isAttemptExpired(row, now)) await finishGate(userId, attemptId, now);

  const a = await prisma.gateAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    select: {
      ...attemptSelect,
      gate: {
        select: {
          id: true,
          tierId: true,
          title: true,
          summary: true,
          passThreshold: true,
          cooldownHours: true,
          timeLimitMinutes: true,
          questions: {
            orderBy: { ord: 'asc' },
            select: { ord: true, question: { select: { id: true, slug: true, title: true, difficulty: true } } },
          },
        },
      },
    },
  });
  const solved = await prisma.submission.findMany({
    where: { gateAttemptId: attemptId, kind: 'gate', status: 'OK' },
    distinct: ['questionId'],
    select: { questionId: true },
  });
  const solvedIds = new Set(solved.map((s) => s.questionId));
  const { gate, ...attempt } = a;
  const { questions, ...g } = gate;
  return {
    attempt,
    gate: { ...g, questionCount: questions.length },
    running: isAttemptRunning(attempt, now),
    questions: questions.map((q) => ({
      questionId: q.question.id,
      slug: q.question.slug,
      title: q.question.title,
      difficulty: q.question.difficulty,
      ord: q.ord,
      solved: solvedIds.has(q.question.id),
    })),
  };
}

/**
 * The user's running attempt (if any) of a gate that contains `questionId` —
 * the exception that makes gate questions reachable while locked.
 */
export async function getRunningAttemptForQuestion(
  userId: string,
  questionId: string,
  now: Date = new Date(),
  db: Db = prisma
): Promise<GateAttemptSummary | null> {
  return db.gateAttempt.findFirst({
    where: {
      userId,
      finishedAt: null,
      deadlineAt: { gt: now },
      gate: { questions: { some: { questionId } } },
    },
    orderBy: { startedAt: 'desc' },
    select: attemptSelect,
  });
}

/**
 * Guard for a `gate` submission: the attempt must be the user's, still
 * running, and its gate must contain the question. Returns the attempt.
 */
export async function assertGateSubmissionAllowed(
  userId: string,
  attemptId: string,
  questionId: string,
  now: Date = new Date()
): Promise<GateAttemptSummary> {
  const a = await prisma.gateAttempt.findUnique({
    where: { id: attemptId },
    select: { ...attemptSelect, userId: true, gate: { select: { questions: { where: { questionId }, select: { questionId: true } } } } },
  });
  if (!a || a.userId !== userId) throw new NotFoundError('gate attempt', attemptId);
  if (a.gate.questions.length === 0) throw new AccessDenied('forbidden', 'That question is not part of this gate.');
  if (!isAttemptRunning(a, now)) throw new AccessDenied('gate_attempt_closed', 'This gate attempt has ended.');
  const { gate: _gate, userId: _userId, ...attempt } = a;
  return attempt;
}
