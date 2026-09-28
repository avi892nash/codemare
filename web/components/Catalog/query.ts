/**
 * The /problems URL contract. Pure (no React, no server imports): the server
 * page parses with it and the client filters and pagination build links with
 * it, so both sides always agree.
 *
 *   q           free text, ≤ 100 chars; every word must appear in the title
 *               or in a tag ("hash table" matches the tag hash-table)
 *   difficulty  Easy | Medium | Hard       repeatable (or comma-separated)
 *   status      solved | attempted | todo  this user's progress
 *   topic       a topic slug
 *   tag         a tag                      repeatable (or comma-separated)
 *   company     a company name             repeatable
 *   page        1-based, 20 rows per page
 *
 * Different facets combine with AND; several values of one facet with OR.
 * Unknown or malformed values are dropped, never an error.
 */
import { DIFFICULTIES, type Difficulty } from '@/lib/types';

export const CATALOG_PATH = '/problems';
export const CATALOG_PAGE_SIZE = 20;
export const MAX_QUERY_LENGTH = 100;
const MAX_VALUES = 20;
const MAX_VALUE_LENGTH = 64;
const MAX_PAGE = 10_000;

export const CATALOG_STATUSES = ['solved', 'attempted', 'todo'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const CATALOG_STATUS_LABEL: Record<CatalogStatus, string> = {
  solved: 'Solved',
  attempted: 'Attempted',
  todo: 'To do',
};

export interface CatalogQuery {
  q: string;
  difficulties: Difficulty[];
  status: CatalogStatus | null;
  topic: string | null;
  tags: string[];
  companies: string[];
  page: number;
}

export const EMPTY_CATALOG_QUERY: CatalogQuery = {
  q: '',
  difficulties: [],
  status: null,
  topic: null,
  tags: [],
  companies: [],
  page: 1,
};

/** Search params as Next hands them to a page, or a URLSearchParams. */
export type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function all(src: ParamSource, key: string): string[] {
  if (src instanceof URLSearchParams) return src.getAll(key);
  const v = src[key];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

/** Trim, collapse inner whitespace, cap the length. */
export function normalizeSearch(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH).trim();
}

const splitCommas = (values: string[]) => values.flatMap((v) => v.split(','));

function cleanList(values: string[], normalize: (v: string) => string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = normalize(raw.trim());
    if (!v || v.length > MAX_VALUE_LENGTH) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length === MAX_VALUES) break;
  }
  return out;
}

const DIFFICULTY_BY_LOWER = new Map(DIFFICULTIES.map((d) => [d.toLowerCase(), d]));
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export function parseCatalogQuery(src: ParamSource): CatalogQuery {
  const wanted = new Set(
    splitCommas(all(src, 'difficulty'))
      .map((d) => DIFFICULTY_BY_LOWER.get(d.trim().toLowerCase()))
      .filter((d): d is Difficulty => d !== undefined)
  );
  const status = all(src, 'status')
    .map((s) => s.trim().toLowerCase())
    .find((s): s is CatalogStatus => (CATALOG_STATUSES as readonly string[]).includes(s));
  const topic = (all(src, 'topic')[0] ?? '').trim().toLowerCase();
  const page = Number.parseInt(all(src, 'page')[0] ?? '', 10);

  return {
    q: normalizeSearch(all(src, 'q')[0] ?? ''),
    difficulties: DIFFICULTIES.filter((d) => wanted.has(d)),
    status: status ?? null,
    topic: topic && topic.length <= MAX_VALUE_LENGTH && SLUG_RE.test(topic) ? topic : null,
    tags: cleanList(splitCommas(all(src, 'tag')), (t) => t.toLowerCase()),
    companies: cleanList(all(src, 'company'), (c) => c.replace(/\s+/g, ' ')),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** Canonical query string (no leading `?`); defaults are omitted. */
export function catalogSearchString(query: Partial<CatalogQuery>): string {
  const p = new URLSearchParams();
  const q = normalizeSearch(query.q ?? '');
  if (q) p.set('q', q);
  for (const d of query.difficulties ?? []) p.append('difficulty', d);
  if (query.status) p.set('status', query.status);
  if (query.topic) p.set('topic', query.topic);
  for (const t of query.tags ?? []) p.append('tag', t);
  for (const c of query.companies ?? []) p.append('company', c);
  if (query.page && query.page > 1) p.set('page', String(query.page));
  return p.toString();
}

/** `/problems?…` for `query` with `patch` applied. Any filter change resets to page 1. */
export function catalogHref(query: CatalogQuery, patch: Partial<CatalogQuery> = {}): string {
  const touchesFilters = Object.keys(patch).some((k) => k !== 'page');
  const next: CatalogQuery = { ...query, ...patch, page: patch.page ?? (touchesFilters ? 1 : query.page) };
  const qs = catalogSearchString(next);
  return qs ? `${CATALOG_PATH}?${qs}` : CATALOG_PATH;
}

/** Any filter (not the page) set? */
export function hasActiveFilters(query: CatalogQuery): boolean {
  return Boolean(
    query.q || query.difficulties.length || query.status || query.topic || query.tags.length || query.companies.length
  );
}

/** Facet filters shown behind the mobile "Filters" toggle (everything but q). */
export function countFacetFilters(query: CatalogQuery): number {
  return (
    query.difficulties.length + (query.status ? 1 : 0) + (query.topic ? 1 : 0) + query.tags.length + query.companies.length
  );
}

/** Search words for matching: lowercase, split on whitespace. */
export function searchWords(q: string): string[] {
  return normalizeSearch(q).toLowerCase().split(' ').filter(Boolean);
}

/** Page numbers for a pager: first, last, current ± 1; `null` marks a gap. */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  const keep = new Set([1, pageCount, page - 1, page, page + 1]);
  const out: Array<number | null> = [];
  for (let p = 1; p <= pageCount; p++) {
    if (keep.has(p)) out.push(p);
    else if (out[out.length - 1] !== null) out.push(null);
  }
  return out;
}
