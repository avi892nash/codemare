import 'server-only';
import { Prisma } from '@prisma/client';
import type { SubmissionKind, SubmissionStatus, SupportedLanguage, Verdict } from '@/lib/types';
import { prisma, TX_OPTIONS, type Db } from './db';
import { recordComponentVersion } from './components';
import { InvalidInput, NotFoundError } from './errors';
import {
  normalizeVerdict,
  sanitizeTestOutcome,
  summarizeOutcomes,
  type PublicTestResult,
  type TestOutcome,
} from './rules/testResults';

export type { PublicTestResult, TestOutcome };

/**
 * Submission lifecycle (spec §2 submissions/test_results, §4):
 *
 *   createSubmission   → status `queued`
 *   markSubmissionRunning
 *   completeSubmission → verdict + totals + test_results (hidden tests
 *                        stripped); a `build` also records its
 *                        component_versions row
 *   then, on OK: onAcceptedSubmit / onBuildPassed (awards.ts)
 */

export interface CreateSubmissionInput {
  userId: string;
  kind: SubmissionKind;
  language: SupportedLanguage;
  code: string;
  /** Required for run / submit / gate. */
  questionId?: string | null;
  /** Required for build. */
  buildStepId?: string | null;
  /** Required for gate. */
  gateAttemptId?: string | null;
}

export interface SubmissionResultInput {
  /** The judge's verdict. `OK` is downgraded to `WA` unless every test passed. */
  status: Verdict;
  /** Per-test outcomes in test order (empty for CE / XX). */
  tests: TestOutcome[];
  compileMs?: number | null;
  error?: string | null;
}

export interface CompletedSubmission {
  id: string;
  kind: SubmissionKind;
  status: Verdict;
  totalPassed: number;
  totalTests: number;
  /** Σ per-test CPU µs. */
  runtimeUs: number | null;
  /** Max per-test KB. */
  memoryKb: number | null;
  compileMs: number | null;
  error: string | null;
  tests: PublicTestResult[];
  /** Set for `build` submissions. */
  componentVersionId: string | null;
}

/** Start a submission (status `queued`). Validates the kind ↔ reference pairing. */
export async function createSubmission(input: CreateSubmissionInput): Promise<{ id: string; createdAt: Date }> {
  const { kind } = input;
  if ((kind === 'run' || kind === 'submit' || kind === 'gate') && !input.questionId) {
    throw new InvalidInput(`a ${kind} submission needs a questionId`);
  }
  if (kind === 'build' && !input.buildStepId) throw new InvalidInput('a build submission needs a buildStepId');
  if (kind === 'gate' && !input.gateAttemptId) throw new InvalidInput('a gate submission needs a gateAttemptId');
  return prisma.submission.create({
    data: {
      userId: input.userId,
      kind,
      language: input.language,
      code: input.code,
      questionId: input.questionId ?? null,
      buildStepId: input.buildStepId ?? null,
      gateAttemptId: kind === 'gate' ? input.gateAttemptId : null,
      status: 'queued',
    },
    select: { id: true, createdAt: true },
  });
}

/** queued → running (no-op otherwise). */
export async function markSubmissionRunning(submissionId: string): Promise<void> {
  await prisma.submission.updateMany({ where: { id: submissionId, status: 'queued' }, data: { status: 'running' } });
}

function jsonOrDbNull(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | typeof Prisma.JsonNull {
  if (v === undefined) return Prisma.DbNull;
  if (v === null) return Prisma.JsonNull;
  return v as Prisma.InputJsonValue;
}

/**
 * Store per-test results. Hidden tests keep no input/expected/actual (NULL),
 * explain_on_fail is kept only for failed tests. Replaces earlier rows.
 */
export async function saveTestResults(
  submissionId: string,
  tests: readonly TestOutcome[],
  db: Db = prisma
): Promise<PublicTestResult[]> {
  const clean = tests.map(sanitizeTestOutcome);
  await db.testResult.deleteMany({ where: { submissionId } });
  if (clean.length > 0) {
    await db.testResult.createMany({
      data: clean.map((t) => ({
        submissionId,
        idx: t.idx,
        passed: t.passed,
        hidden: t.hidden,
        runtimeUs: t.runtimeUs,
        memoryKb: t.memoryKb,
        input: jsonOrDbNull(t.input),
        expected: jsonOrDbNull(t.expected),
        actual: jsonOrDbNull(t.actual),
        error: t.error ?? null,
        explainOnFail: t.explainOnFail ?? null,
      })),
    });
  }
  return clean;
}

/**
 * Finalize a submission with the judge's result, in one transaction:
 * verdict, totals (runtime = Σ CPU µs, memory = max), test_results, and for
 * a `build` the component_versions row (passed = verdict OK). Throws
 * InvalidInput if the submission already has a verdict.
 */
export async function completeSubmission(
  submissionId: string,
  result: SubmissionResultInput
): Promise<CompletedSubmission> {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.submission.findUnique({
      where: { id: submissionId },
      select: {
        id: true,
        userId: true,
        kind: true,
        status: true,
        language: true,
        code: true,
        buildStep: { select: { componentId: true } },
      },
    });
    if (!sub) throw new NotFoundError('submission', submissionId);
    if (sub.status !== 'queued' && sub.status !== 'running') {
      throw new InvalidInput(`submission ${submissionId} is already complete`);
    }

    const totals = summarizeOutcomes(result.tests);
    const status = normalizeVerdict(result.status, totals.totalPassed, totals.totalTests);
    const compileMs = result.compileMs == null ? null : Math.round(result.compileMs);
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        status,
        totalPassed: totals.totalPassed,
        totalTests: totals.totalTests,
        runtimeUs: totals.runtimeUs == null ? null : BigInt(totals.runtimeUs),
        memoryKb: totals.memoryKb,
        compileMs,
        error: result.error ?? null,
      },
    });
    const tests = await saveTestResults(submissionId, result.tests, tx);

    let componentVersionId: string | null = null;
    if (sub.kind === 'build' && sub.buildStep) {
      componentVersionId = (
        await recordComponentVersion(
          {
            userId: sub.userId,
            componentId: sub.buildStep.componentId,
            language: sub.language,
            code: sub.code,
            passed: status === 'OK',
            submissionId,
          },
          tx
        )
      ).id;
    }

    return {
      id: submissionId,
      kind: sub.kind,
      status,
      totalPassed: totals.totalPassed,
      totalTests: totals.totalTests,
      runtimeUs: totals.runtimeUs,
      memoryKb: totals.memoryKb,
      compileMs,
      error: result.error ?? null,
      tests,
      componentVersionId,
    };
  }, TX_OPTIONS);
}

export interface SubmissionDetail {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  language: SupportedLanguage;
  code: string;
  totalPassed: number;
  totalTests: number;
  runtimeUs: number | null;
  memoryKb: number | null;
  compileMs: number | null;
  error: string | null;
  percentile: number | null;
  createdAt: Date;
  question: { id: string; slug: string; title: string; difficulty: string } | null;
  buildStepId: string | null;
  gateAttemptId: string | null;
  tests: PublicTestResult[];
}

/** One of the user's submissions with its test results (for /submissions/[id]). Null if not theirs. */
export async function getSubmissionDetail(userId: string, submissionId: string): Promise<SubmissionDetail | null> {
  const s = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      question: { select: { id: true, slug: true, title: true, difficulty: true } },
      testResults: { orderBy: { idx: 'asc' } },
    },
  });
  if (!s || s.userId !== userId) return null;
  return {
    id: s.id,
    kind: s.kind,
    status: s.status,
    language: s.language,
    code: s.code,
    totalPassed: s.totalPassed,
    totalTests: s.totalTests,
    runtimeUs: s.runtimeUs == null ? null : Number(s.runtimeUs),
    memoryKb: s.memoryKb,
    compileMs: s.compileMs,
    error: s.error,
    percentile: s.percentile,
    createdAt: s.createdAt,
    question: s.question,
    buildStepId: s.buildStepId,
    gateAttemptId: s.gateAttemptId,
    tests: s.testResults.map((t) => {
      const out: PublicTestResult = {
        idx: t.idx,
        passed: t.passed,
        hidden: t.hidden,
        runtimeUs: t.runtimeUs,
        memoryKb: t.memoryKb,
      };
      if (!t.hidden) {
        out.input = t.input;
        out.expected = t.expected;
        out.actual = t.actual;
      }
      if (t.error) out.error = t.error;
      if (t.explainOnFail) out.explainOnFail = t.explainOnFail;
      return out;
    }),
  };
}
