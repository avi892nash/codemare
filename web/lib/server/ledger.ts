import 'server-only';
import type { Difficulty } from '@/lib/types';
import { prisma, withUserLock, type Db, type Tx } from './db';
import { InsufficientTokens, InvalidInput, NotFoundError } from './errors';
import { scorePenaltyFrom, type HintTarget } from './rules/hints';
import { balancesFromRows, planDebits, type Balances, type Debit, type Requirement } from './rules/recipes';
import { buildAward, solveAward } from './rules/scoring';

/**
 * The token ledger (spec §3.1–3.3). app.token_ledger is append-only: an earn
 * is a positive row (idempotent through a partial unique index), a spend is
 * one negative row per bucket touched, written under the user's advisory
 * lock after re-reading balances.
 */

export type { Balances, Debit, Requirement };

/** Tokens credited by an earn. */
export interface TokenAward {
  topicId: string;
  topicSlug: string;
  topicTitle: string;
  amount: number;
  sourceDifficulty: Difficulty;
}

/** Why tokens are being spent (ledger reason + ref). */
export type SpendRef =
  | { reason: 'unlock'; refType: 'recipe'; refId: string }
  | { reason: 'hint'; refType: 'hint'; refId: string }
  | { reason: 'admin'; refType: 'admin'; refId: string };

export interface TopicBalance {
  topicId: string;
  slug: string;
  title: string;
  total: number;
  byDifficulty: Record<Difficulty, number>;
}

// ─── Reads ───────────────────────────────────────────────────────────────

/** Bucket balances `SUM(amount)` per (topic, source difficulty), optionally for some topics only. */
export async function getBalances(
  userId: string,
  opts: { topicIds?: string[] } = {},
  db: Db = prisma
): Promise<Balances> {
  const rows = await db.tokenLedger.groupBy({
    by: ['topicId', 'sourceDifficulty'],
    where: { userId, ...(opts.topicIds ? { topicId: { in: opts.topicIds } } : {}) },
    _sum: { amount: true },
  });
  return balancesFromRows(
    rows.map((r) => ({ topicId: r.topicId, difficulty: r.sourceDifficulty, amount: r._sum.amount ?? 0 }))
  );
}

/** Per-topic balances (topic balance = sum of its buckets) for every topic the user has touched. */
export async function getTopicBalances(userId: string, db: Db = prisma): Promise<TopicBalance[]> {
  const balances = await getBalances(userId, {}, db);
  const topicIds = Object.keys(balances);
  if (topicIds.length === 0) return [];
  const topics = await db.topic.findMany({
    where: { id: { in: topicIds } },
    select: { id: true, slug: true, title: true, ord: true, tier: { select: { ord: true } } },
  });
  return topics
    .sort((a, b) => a.tier.ord - b.tier.ord || a.ord - b.ord)
    .map((t) => {
      const b = balances[t.id] ?? {};
      const byDifficulty = {
        Easy: Math.max(0, b.Easy ?? 0),
        Medium: Math.max(0, b.Medium ?? 0),
        Hard: Math.max(0, b.Hard ?? 0),
      };
      return {
        topicId: t.id,
        slug: t.slug,
        title: t.title,
        total: byDifficulty.Easy + byDifficulty.Medium + byDifficulty.Hard,
        byDifficulty,
      };
    });
}

/**
 * Score penalty (%) on a question's / build step's future award: the sum of
 * score-kind hint costs the user revealed on it, capped at 100.
 */
export async function getScorePenalty(userId: string, target: HintTarget, db: Db = prisma): Promise<number> {
  const uses = await db.hintUse.findMany({
    where: {
      userId,
      costKind: 'score',
      ...('questionId' in target ? { questionId: target.questionId } : { buildStepId: target.buildStepId }),
    },
    select: { costKind: true, costAmount: true },
  });
  return scorePenaltyFrom(uses);
}

// ─── Earning (spec §3.2) ─────────────────────────────────────────────────

/**
 * Credit a question's solve tokens — call on the first accepted `submit`.
 * Idempotent: returns [] if this question already paid out (or races with a
 * concurrent call that did). Per topic: round(BASE × weight × (1 − penalty%)).
 * Drafts (an author testing their own question) never pay.
 */
export async function earnForSolve(userId: string, questionId: string, db: Db = prisma): Promise<TokenAward[]> {
  const q = await db.question.findUnique({
    where: { id: questionId },
    select: {
      difficulty: true,
      status: true,
      topics: { select: { topicId: true, weight: true, topic: { select: { slug: true, title: true } } } },
    },
  });
  if (!q) throw new NotFoundError('question', questionId);
  if (q.status !== 'published') return [];

  const already = await db.tokenLedger.findFirst({
    where: { userId, reason: 'solve', refType: 'question', refId: questionId, amount: { gt: 0 } },
    select: { id: true },
  });
  if (already) return [];

  const penalty = await getScorePenalty(userId, { questionId }, db);
  const rows = solveAward(q.difficulty, q.topics, penalty);
  if (rows.length === 0) return [];

  const inserted = await db.tokenLedger.createManyAndReturn({
    data: rows.map((r) => ({
      userId,
      topicId: r.topicId,
      amount: r.amount,
      sourceDifficulty: q.difficulty,
      reason: 'solve' as const,
      refType: 'question' as const,
      refId: questionId,
    })),
    skipDuplicates: true,
    select: { topicId: true, amount: true, sourceDifficulty: true },
  });
  const meta = new Map(q.topics.map((t) => [t.topicId, t.topic]));
  return inserted.map((r) => ({
    topicId: r.topicId,
    topicSlug: meta.get(r.topicId)!.slug,
    topicTitle: meta.get(r.topicId)!.title,
    amount: r.amount,
    sourceDifficulty: r.sourceDifficulty,
  }));
}

/**
 * Credit a build step's tokens — call on its first passing `build`. One row
 * to the component's topic: round(BASE[step difficulty] × (1 − penalty%)).
 * Idempotent; predict steps never pay.
 */
export async function earnForBuild(userId: string, buildStepId: string, db: Db = prisma): Promise<TokenAward[]> {
  const step = await db.buildStep.findUnique({
    where: { id: buildStepId },
    select: {
      kind: true,
      difficulty: true,
      component: { select: { topicId: true, topic: { select: { slug: true, title: true } } } },
    },
  });
  if (!step) throw new NotFoundError('build step', buildStepId);
  if (step.kind !== 'build') return [];

  const already = await db.tokenLedger.findFirst({
    where: { userId, reason: 'build', refType: 'build_step', refId: buildStepId, amount: { gt: 0 } },
    select: { id: true },
  });
  if (already) return [];

  const penalty = await getScorePenalty(userId, { buildStepId }, db);
  const amount = buildAward(step.difficulty, penalty);
  if (amount <= 0) return [];

  const inserted = await db.tokenLedger.createManyAndReturn({
    data: [
      {
        userId,
        topicId: step.component.topicId,
        amount,
        sourceDifficulty: step.difficulty,
        reason: 'build' as const,
        refType: 'build_step' as const,
        refId: buildStepId,
      },
    ],
    skipDuplicates: true,
    select: { amount: true, sourceDifficulty: true },
  });
  return inserted.map((r) => ({
    topicId: step.component.topicId,
    topicSlug: step.component.topic.slug,
    topicTitle: step.component.topic.title,
    amount: r.amount,
    sourceDifficulty: r.sourceDifficulty,
  }));
}

// ─── Spending (spec §3.3) ────────────────────────────────────────────────

/**
 * Debit tokens for `requirements` in one transaction under the user's
 * advisory lock: re-read balances, debit qualifying buckets in ascending
 * difficulty (skipping buckets below each min), one negative row per bucket.
 * Throws InsufficientTokens — with nothing written — on any shortfall.
 *
 * Pass `tx` to run inside a caller's transaction (e.g. spend + unlock row).
 */
export async function spend(
  userId: string,
  requirements: readonly Requirement[],
  ref: SpendRef,
  tx?: Tx
): Promise<Debit[]> {
  if (requirements.some((r) => !Number.isInteger(r.quantity) || r.quantity < 0)) {
    throw new InvalidInput('spend quantities must be non-negative integers');
  }
  return withUserLock(
    userId,
    async (t) => {
      const topicIds = [...new Set(requirements.map((r) => r.topicId))];
      const balances = await getBalances(userId, { topicIds }, t);
      const plan = planDebits(balances, requirements);
      if (!plan.ok) throw new InsufficientTokens(plan.shortfalls);
      if (plan.debits.length > 0) {
        await t.tokenLedger.createMany({
          data: plan.debits.map((d) => ({
            userId,
            topicId: d.topicId,
            amount: -d.amount,
            sourceDifficulty: d.difficulty,
            reason: ref.reason,
            refType: ref.refType,
            refId: ref.refId,
          })),
        });
      }
      return plan.debits;
    },
    tx
  );
}

/**
 * Staff/dev credit: add `amount` (> 0) tokens to one bucket with reason
 * `admin`. Idempotent per `refId` (use a fresh id per grant). Debits go
 * through `spend(…, { reason: 'admin', … })` so they can never overdraw.
 */
export async function grantTokens(
  userId: string,
  grant: { topicId: string; difficulty: Difficulty; amount: number; refId: string },
  db: Db = prisma
): Promise<void> {
  if (!Number.isInteger(grant.amount) || grant.amount <= 0) {
    throw new InvalidInput('grant amount must be a positive integer');
  }
  await db.tokenLedger.createMany({
    data: [
      {
        userId,
        topicId: grant.topicId,
        amount: grant.amount,
        sourceDifficulty: grant.difficulty,
        reason: 'admin',
        refType: 'admin',
        refId: grant.refId,
      },
    ],
    skipDuplicates: true,
  });
}
