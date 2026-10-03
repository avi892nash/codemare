import 'server-only';
import { prisma, type Db } from './db';
import { evaluateBadges, type AwardedBadge } from './badges';
import { InvalidInput, NotFoundError } from './errors';
import { earnForSolve, type TokenAward } from './ledger';
import { MIN_PERCENTILE_SAMPLE, percentileOf, percentileToShow } from './rules/scoring';

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
  /**
   * "Faster than N% of other learners" (submit only). Null for gate
   * submissions, and while fewer than MIN_PERCENTILE_SAMPLE accepted solutions
   * exist to compare against — the value is stored either way (badges read it),
   * the interface just doesn't show a comparison with two or three people.
   */
  percentile: number | null;
  badgesAwarded: AwardedBadge[];
}

function view(awards: TokenAward[]): TokenAwardView[] {
  return awards.map((a) => ({ topic: a.topicSlug, title: a.topicTitle, amount: a.amount }));
}

/**
 * Percentile of an accepted submit (spec §3.8): among the latest accepted
 * submit per user for the same question and language, the % whose
 * runtime_us is strictly greater. Stores it on the submission, together with
 * how many solutions it was compared against (`sample`, this one included).
 */
export async function percentileWithSample(
  submissionId: string,
  db: Db = prisma
): Promise<{ percentile: number | null; sample: number }> {
  const s = await db.submission.findUnique({
    where: { id: submissionId },
    select: { questionId: true, language: true, runtimeUs: true, kind: true, status: true },
  });
  if (!s) throw new NotFoundError('submission', submissionId);
  if (s.kind !== 'submit' || s.status !== 'OK' || !s.questionId || s.runtimeUs == null) return { percentile: null, sample: 0 };

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
  return { percentile, sample: rows.length };
}

/** The stored percentile of an accepted submit (see percentileWithSample). */
export async function computePercentile(submissionId: string, db: Db = prisma): Promise<number | null> {
  return (await percentileWithSample(submissionId, db)).percentile;
}

/**
 * How many learners' latest accepted solutions each language of a question
 * has — the sample a stored percentile was (or would be) compared against. For
 * the pages that show a percentile they did not just compute: they hide it
 * (percentileToShow) in the languages below MIN_PERCENTILE_SAMPLE.
 */
export async function percentileSamples(questionId: string, db: Db = prisma): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ language: string; n: number }[]>`
    SELECT language::text AS language, COUNT(DISTINCT user_id)::int AS n
    FROM "app"."submissions"
    WHERE question_id = ${questionId}
      AND kind = 'submit' AND status = 'OK'
      AND runtime_us IS NOT NULL
    GROUP BY language`;
  return new Map(rows.map((r) => [r.language, r.n]));
}

/** Languages of `samples` with enough solutions behind their percentile to show it. */
export function comparableLanguages(samples: ReadonlyMap<string, number>): Set<string> {
  return new Set([...samples].filter(([, n]) => n >= MIN_PERCENTILE_SAMPLE).map(([language]) => language));
}

/**
 * After an accepted `submit` (or `gate`) submission: first-solve tokens
 * (idempotent — later accepts earn nothing), percentile, then badges.
 * Gate submissions earn no tokens and get no percentile (spec §3.2). The
 * percentile handed back is the one to show (null below MIN_PERCENTILE_SAMPLE
 * solutions); the stored one is always the real number.
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
    const stored = await percentileWithSample(submissionId);
    percentile = percentileToShow(stored.percentile, stored.sample);
  }
  const badgesAwarded = await evaluateBadges(userId);
  return { tokensAwarded, percentile, badgesAwarded };
}
