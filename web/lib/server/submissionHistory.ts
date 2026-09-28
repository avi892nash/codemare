import 'server-only';
import type { Prisma } from '@prisma/client';
import type { Difficulty, SubmissionKind, SubmissionStatus, SupportedLanguage } from '@/lib/types';
import { SUBMISSIONS_PAGE_SIZE, type SubmissionQuery } from '@/components/Submissions/query';
import { prisma } from './db';
import { hasRole } from './rules/roles';
import { signatureSchema } from './schemas';
import { getSubmissionDetail } from './submissions';

/**
 * Submission history (/submissions, /submissions/[id]).
 *
 *   listUserSubmissions — the user's own submissions, newest first, filtered
 *                         and paginated (status / language / kind)
 *   getSubmissionView   — one submission for a viewer: its owner or staff+;
 *                         anyone else gets null (the page 404s). Built on
 *                         getSubmissionDetail; hidden tests are reduced to
 *                         pass/fail.
 */

/** What a submission was for. */
export type SubmissionSubject =
  | { type: 'question'; slug: string; title: string; difficulty: Difficulty }
  | { type: 'build'; componentSlug: string; componentTitle: string; stepTitle: string }
  | { type: 'none' };

export interface SubmissionListRow {
  id: string;
  kind: SubmissionKind;
  status: SubmissionStatus;
  language: SupportedLanguage;
  /** Σ per-test CPU µs. */
  runtimeUs: number | null;
  memoryKb: number | null;
  totalPassed: number;
  totalTests: number;
  createdAt: Date;
  subject: SubmissionSubject;
}

export interface SubmissionList {
  rows: SubmissionListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  /** The user has at least one submission (picks the empty state). */
  hasAny: boolean;
}

const subjectSelect = {
  question: { select: { slug: true, title: true, difficulty: true } },
  buildStep: { select: { title: true, component: { select: { slug: true, title: true } } } },
} satisfies Prisma.SubmissionSelect;

type SubjectRow = Prisma.SubmissionGetPayload<{ select: typeof subjectSelect }>;

function toSubject(row: SubjectRow): SubmissionSubject {
  if (row.question) {
    const { slug, title, difficulty } = row.question;
    return { type: 'question', slug, title, difficulty };
  }
  if (row.buildStep) {
    return {
      type: 'build',
      componentSlug: row.buildStep.component.slug,
      componentTitle: row.buildStep.component.title,
      stepTitle: row.buildStep.title,
    };
  }
  return { type: 'none' };
}

function whereFor(userId: string, q: SubmissionQuery): Prisma.SubmissionWhereInput {
  return {
    userId,
    ...(q.status === 'pending' ? { status: { in: ['queued', 'running'] } } : q.status ? { status: q.status } : {}),
    ...(q.language ? { language: q.language } : {}),
    ...(q.kind ? { kind: q.kind } : {}),
  };
}

export async function listUserSubmissions(
  userId: string,
  query: SubmissionQuery,
  opts: { pageSize?: number } = {}
): Promise<SubmissionList> {
  const pageSize = opts.pageSize ?? SUBMISSIONS_PAGE_SIZE;
  const where = whereFor(userId, query);
  const total = await prisma.submission.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page), pageCount);
  const [rows, hasAny] = await Promise.all([
    total === 0
      ? Promise.resolve([])
      : prisma.submission.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            kind: true,
            status: true,
            language: true,
            runtimeUs: true,
            memoryKb: true,
            totalPassed: true,
            totalTests: true,
            createdAt: true,
            ...subjectSelect,
          },
        }),
    total > 0 ? Promise.resolve(true) : prisma.submission.count({ where: { userId }, take: 1 }).then((n) => n > 0),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      language: r.language,
      runtimeUs: r.runtimeUs == null ? null : Number(r.runtimeUs),
      memoryKb: r.memoryKb,
      totalPassed: r.totalPassed,
      totalTests: r.totalTests,
      createdAt: r.createdAt,
      subject: toSubject(r),
    })),
    total,
    page,
    pageCount,
    pageSize,
    hasAny,
  };
}

// ─── detail ──────────────────────────────────────────────────────────────

export interface SubmissionTestView {
  idx: number;
  passed: boolean;
  hidden: boolean;
  /** Visible tests only from here on. */
  runtimeUs?: number | null;
  memoryKb?: number | null;
  /** The call's arguments, named from the signature when it matches. */
  args?: Array<{ name: string | null; value: unknown }>;
  expected?: unknown;
  actual?: unknown;
  error?: string;
  /** Failed visible tests only. */
  explainOnFail?: string;
}

export interface SubmissionView {
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
  subject: SubmissionSubject;
  owner: { handle: string; name: string | null };
  /** The viewer is the owner (false: a staff member looking at someone else's). */
  own: boolean;
  tests: SubmissionTestView[];
}

/** Parameter names from a stored signature, or null when it doesn't parse. */
function paramNames(signature: unknown): string[] | null {
  const parsed = signatureSchema.safeParse(signature);
  return parsed.success ? parsed.data.params.map((p) => p.name) : null;
}

function labelArgs(input: unknown, names: string[] | null): Array<{ name: string | null; value: unknown }> {
  if (!Array.isArray(input)) return [{ name: null, value: input }];
  const named = names && names.length === input.length;
  return input.map((value, i) => ({ name: named ? names[i] : null, value }));
}

/**
 * A submission as `viewerId` may see it: the owner always, staff and admins
 * for anyone's; otherwise null (render a 404, never a 403, so ids can't be
 * probed). Hidden tests keep only their pass/fail.
 */
export async function getSubmissionView(viewerId: string, submissionId: string): Promise<SubmissionView | null> {
  if (!submissionId || submissionId.length > 64) return null;
  const meta = await prisma.submission.findUnique({
    where: { id: submissionId },
    select: {
      userId: true,
      user: { select: { handle: true, name: true } },
      question: { select: { slug: true, title: true, difficulty: true, signature: true } },
      buildStep: { select: { title: true, component: { select: { slug: true, title: true, signature: true } } } },
    },
  });
  if (!meta) return null;

  const own = meta.userId === viewerId;
  if (!own) {
    const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } });
    if (!hasRole(viewer?.role, 'staff')) return null;
  }

  const detail = await getSubmissionDetail(meta.userId, submissionId);
  if (!detail) return null;
  const names = paramNames(meta.question?.signature ?? meta.buildStep?.component.signature);

  return {
    id: detail.id,
    kind: detail.kind,
    status: detail.status,
    language: detail.language,
    code: detail.code,
    totalPassed: detail.totalPassed,
    totalTests: detail.totalTests,
    runtimeUs: detail.runtimeUs,
    memoryKb: detail.memoryKb,
    compileMs: detail.compileMs,
    error: detail.error,
    percentile: detail.percentile,
    createdAt: detail.createdAt,
    subject: toSubject(meta),
    owner: meta.user,
    own,
    tests: detail.tests.map((t): SubmissionTestView => {
      if (t.hidden) return { idx: t.idx, passed: t.passed, hidden: true };
      return {
        idx: t.idx,
        passed: t.passed,
        hidden: false,
        runtimeUs: t.runtimeUs,
        memoryKb: t.memoryKb,
        args: labelArgs(t.input, names),
        expected: t.expected,
        actual: t.actual,
        ...(t.error ? { error: t.error } : {}),
        ...(!t.passed && t.explainOnFail ? { explainOnFail: t.explainOnFail } : {}),
      };
    }),
  };
}
