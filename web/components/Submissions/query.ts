/**
 * The /submissions URL contract (pure; shared by the page and its filters).
 *
 *   status    OK | WA | TLE | MLE | RE | CE | XX | pending (queued or running)
 *   language  python | javascript | typescript | cpp | java | go
 *   kind      submit | run | build | gate
 *   page      1-based, 20 per page, newest first
 */
import { LANGUAGES, VERDICTS, type SubmissionKind, type SupportedLanguage, type Verdict } from '@/lib/types';

export const SUBMISSIONS_PATH = '/submissions';
export const SUBMISSIONS_PAGE_SIZE = 20;

export const SUBMISSION_KINDS = ['submit', 'run', 'build', 'gate'] as const satisfies readonly SubmissionKind[];

export type SubmissionStatusFilter = Verdict | 'pending';
export const STATUS_FILTERS: readonly SubmissionStatusFilter[] = [...VERDICTS, 'pending'];

export interface SubmissionQuery {
  status: SubmissionStatusFilter | null;
  language: SupportedLanguage | null;
  kind: SubmissionKind | null;
  page: number;
}

export const EMPTY_SUBMISSION_QUERY: SubmissionQuery = { status: null, language: null, kind: null, page: 1 };

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function first(src: ParamSource, key: string): string {
  if (src instanceof URLSearchParams) return src.get(key) ?? '';
  const v = src[key];
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export function parseSubmissionQuery(src: ParamSource): SubmissionQuery {
  const rawStatus = first(src, 'status').trim();
  const status =
    rawStatus.toLowerCase() === 'pending'
      ? 'pending'
      : (VERDICTS as readonly string[]).includes(rawStatus.toUpperCase())
        ? (rawStatus.toUpperCase() as Verdict)
        : null;
  const language = first(src, 'language').trim().toLowerCase();
  const kind = first(src, 'kind').trim().toLowerCase();
  const page = Number.parseInt(first(src, 'page'), 10);
  return {
    status,
    language: (LANGUAGES as readonly string[]).includes(language) ? (language as SupportedLanguage) : null,
    kind: (SUBMISSION_KINDS as readonly string[]).includes(kind) ? (kind as SubmissionKind) : null,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
  };
}

/** `/submissions?…` with `patch` applied; a filter change resets to page 1. */
export function submissionsHref(query: SubmissionQuery, patch: Partial<SubmissionQuery> = {}): string {
  const touchesFilters = Object.keys(patch).some((k) => k !== 'page');
  const next = { ...query, ...patch, page: patch.page ?? (touchesFilters ? 1 : query.page) };
  const p = new URLSearchParams();
  if (next.status) p.set('status', next.status);
  if (next.language) p.set('language', next.language);
  if (next.kind) p.set('kind', next.kind);
  if (next.page > 1) p.set('page', String(next.page));
  const qs = p.toString();
  return qs ? `${SUBMISSIONS_PATH}?${qs}` : SUBMISSIONS_PATH;
}

export function hasSubmissionFilters(q: SubmissionQuery): boolean {
  return Boolean(q.status || q.language || q.kind);
}
