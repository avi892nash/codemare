import 'server-only';
import { prisma, type Db } from './db';
import { evaluateBadges, type AwardedBadge } from './badges';
import { InvalidInput, NotFoundError } from './errors';
import { earnForSolve, type TokenAward } from './ledger';
import { percentileOf } from './rules/scoring';

/**
 * What an accepted verdict earns (spec §3.2, §3.7, §3.8). The API calls one
 * of these after completeSubmission returned `OK`, and puts the result in
 * the SSE `verdict` event (`tokensAwarded`, `badgesAwarded`, `percentile`).
 */

/** Verdict-event shape of a token award: `{ topic, amount }` (+ title for display). */
export interface TokenAwardView {
  /** Topic slug. */
  topic: string;
  title: string;
  amount: number;
}

export interface AcceptedSubmitAwards {
  tokensAwarded: TokenAwardView[];
  /** "Beats N%" (submit only; null for gate submissions). */
  percentile: number | null;
  badgesAwarded: AwardedBadge[];
}

function view(awards: TokenAward[]): TokenAwardView[] {
  return awards.map((a) => ({ topic: a.topicSlug, title: a.topicTitle, amount: a.amount }));
}

/**
 * Percentile of an accepted submit (spec §3.8): among the latest accepted
 * submit per user for the same question and language, the % whose
 * runtime_us is strictly greater. Stores it on the submission.
 */
export async function computePercentile(submissionId: string, db: Db = prisma): Promise<number | null> {
  const s = await db.submission.findUnique({
    where: { id: submissionId },
    select: { questionId: true, language: true, runtimeUs: true, kind: true, status: true },
  });
  if (!s) throw new NotFoundError('submission', submissionId);
  if (s.kind !== 'submit' || s.status !== 'OK' || !s.questionId || s.runtimeUs == null) return null;

  const rows = await db.$queryRaw<{ runtime_us: bigint }[]>`
    SELECT runtime_us FROM (
      SELECT DISTINCT ON (user_id) user_id, runtime_us
      FROM "app"."submissions"
      WHERE question_id = ${s.questionId}
        AND language = ${s.language}::"content"."Language"
        AND kind = 'submit' AND status = 'OK'
        AND runtime_us IS NOT NULL
      ORDER BY user_id, created_at DESC, id DESC
    ) latest`;
  const percentile = percentileOf(
    Number(s.runtimeUs),
    rows.map((r) => Number(r.runtime_us))
  );
  await db.submission.update({ where: { id: submissionId }, data: { percentile } });
  return percentile;
}

/**
 * After an accepted `submit` (or `gate`) submission: first-solve tokens
 * (idempotent — later accepts earn nothing), percentile, then badges.
 * Gate submissions earn no tokens and get no percentile (spec §3.2).
 */
export async function onAcceptedSubmit(userId: string, submissionId: string): Promise<AcceptedSubmitAwards> {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: { userId: true, kind: true, status: true, questionId: true },
  });
  if (!s || s.userId !== userId) throw new NotFoundError('submission', submissionId);
  if (s.status !== 'OK' || !s.questionId || (s.kind !== 'submit' && s.kind !== 'gate')) {
    throw new InvalidInput('onAcceptedSubmit needs an accepted submit/gate submission of a question');
  }

  let tokensAwarded: TokenAwardView[] = [];
  let percentile: number | null = null;
  if (s.kind === 'submit') {
    tokensAwarded = view(await earnForSolve(userId, s.questionId));
    percentile = await computePercentile(submissionId);
  }
  const badgesAwarded = await evaluateBadges(userId);
  return { tokensAwarded, percentile, badgesAwarded };
}
