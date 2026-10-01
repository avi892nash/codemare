import 'server-only';
import { DIFFICULTIES, VERDICTS, type Difficulty } from '@/lib/types';
import {
  CATALOG_PAGE_SIZE,
  CATALOG_STATUSES,
  searchWords,
  type CatalogQuery,
  type CatalogStatus,
} from '@/components/Catalog/query';
import { questionAccessMap } from './access';
import { prisma } from './db';

/**
 * The problem catalog (/problems): published questions filtered by the URL
 * contract in components/Catalog/query.ts, in curriculum order, one page at a
 * time — with this user's status per question, the lock state from
 * questionAccessMap (spec §3.4: locked questions still list, linking to /map)
 * and acceptance across all users.
 *
 * Filtering happens in memory over a lean projection of the published
 * questions: a curated catalog is hundreds of rows, not millions, and one
 * pass also yields the facet counts the filters show.
 */

export interface CatalogTopic {
  slug: string;
  title: string;
  icon: string;
}

export interface CatalogRow {
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  /** Heaviest weight first. */
  topics: CatalogTopic[];
  tags: string[];
  /** This user's progress. */
  status: CatalogStatus;
  /** False → locked: the row links to /map instead of the editor. */
  accessible: boolean;
  /** Accepted ÷ judged submits and gate submits, all users, 0–100; null before any. */
  acceptance: number | null;
}

export interface TopicFacet extends CatalogTopic {
  tierOrd: number;
  tierTitle: string;
  count: number;
}

export interface ValueFacet {
  value: string;
  count: number;
}

/** Counts per facet value, each computed with every *other* filter applied. */
export interface CatalogFacets {
  difficulty: Record<Difficulty, number>;
  status: Record<CatalogStatus, number>;
  topics: TopicFacet[];
  tags: ValueFacet[];
  companies: ValueFacet[];
}

export interface CatalogResult {
  rows: CatalogRow[];
  /** Questions matching every filter. */
  total: number;
  /** Clamped to 1..pageCount. */
  page: number;
  pageCount: number;
  pageSize: number;
  facets: CatalogFacets;
  /** Whole published catalog, ignoring filters. */
  summary: { questions: number; solved: number; attempted: number };
}

interface Item {
  id: string;
  slug: string;
  title: string;
  titleLower: string;
  difficulty: Difficulty;
  tags: string[];
  tagsLower: string[];
  companies: string[];
  companiesLower: string[];
  topics: Array<CatalogTopic & { weight: number; tierOrd: number; ord: number }>;
  status: CatalogStatus;
}

const DIFFICULTY_RANK: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

/** Every search word appears in the title or in one of the tags. */
export function matchesSearch(item: { title: string; tags: readonly string[] }, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const title = item.title.toLowerCase();
  const tags = item.tags.map((t) => t.toLowerCase());
  return words.every((w) => title.includes(w) || tags.some((t) => t.includes(w)));
}

/**
 * Curriculum order: the primary (heaviest) topic's tier, then that topic's
 * place in its tier, then difficulty, then title. Topic-less questions last.
 */
function compareCurriculum(a: Item, b: Item): number {
  const ta = a.topics[0];
  const tb = b.topics[0];
  if (ta && !tb) return -1;
  if (!ta && tb) return 1;
  if (ta && tb) {
    if (ta.tierOrd !== tb.tierOrd) return ta.tierOrd - tb.tierOrd;
    if (ta.ord !== tb.ord) return ta.ord - tb.ord;
  }
  return (
    DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] ||
    a.title.localeCompare(b.title, 'en') ||
    a.slug.localeCompare(b.slug, 'en')
  );
}

/**
 * This user's progress per question: `solved` once any submit or gate
 * submission is accepted; `attempted` after any run / submit / gate without
 * that. Everything else is `todo`.
 */
export async function userQuestionProgress(userId: string): Promise<Map<string, Exclude<CatalogStatus, 'todo'>>> {
  const groups = await prisma.submission.groupBy({
    by: ['questionId', 'kind', 'status'],
    where: { userId, questionId: { not: null } },
    _count: { _all: true },
  });
  const progress = new Map<string, Exclude<CatalogStatus, 'todo'>>();
  for (const g of groups) {
    if (!g.questionId) continue;
    if (g.status === 'OK' && (g.kind === 'submit' || g.kind === 'gate')) progress.set(g.questionId, 'solved');
    else if (!progress.has(g.questionId)) progress.set(g.questionId, 'attempted');
  }
  return progress;
}

/** Acceptance per question (percent, one decimal) over judged submit + gate submissions. */
export async function acceptanceRates(questionIds: string[]): Promise<Map<string, number>> {
  if (questionIds.length === 0) return new Map();
  const groups = await prisma.submission.groupBy({
    by: ['questionId', 'status'],
    where: { questionId: { in: questionIds }, kind: { in: ['submit', 'gate'] }, status: { in: [...VERDICTS] } },
    _count: { _all: true },
  });
  const totals = new Map<string, { ok: number; all: number }>();
  for (const g of groups) {
    if (!g.questionId) continue;
    const t = totals.get(g.questionId) ?? { ok: 0, all: 0 };
    t.all += g._count._all;
    if (g.status === 'OK') t.ok += g._count._all;
    totals.set(g.questionId, t);
  }
  return new Map([...totals].map(([id, t]) => [id, Math.round((t.ok / t.all) * 1000) / 10]));
}

/**
 * One display spelling per company (matching is case-insensitive): the most
 * common spelling in the catalog, ties broken by code-unit order.
 */
function companySpellings(items: Item[]): Map<string, string> {
  const seen = new Map<string, Map<string, number>>();
  for (const it of items) {
    for (const c of it.companies) {
      const key = c.toLowerCase();
      const variants = seen.get(key) ?? new Map<string, number>();
      variants.set(c, (variants.get(c) ?? 0) + 1);
      seen.set(key, variants);
    }
  }
  return new Map(
    [...seen].map(([key, variants]) => [
      key,
      [...variants].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0],
    ])
  );
}

type Facet = 'q' | 'difficulty' | 'status' | 'topic' | 'tags' | 'companies';

function predicates(query: CatalogQuery): Record<Facet, (it: Item) => boolean> {
  const words = searchWords(query.q);
  const difficulties = new Set(query.difficulties);
  const tags = new Set(query.tags.map((t) => t.toLowerCase()));
  const companies = new Set(query.companies.map((c) => c.toLowerCase()));
  return {
    q: (it) => matchesSearch(it, words),
    difficulty: (it) => difficulties.size === 0 || difficulties.has(it.difficulty),
    status: (it) => !query.status || it.status === query.status,
    topic: (it) => !query.topic || it.topics.some((t) => t.slug === query.topic),
    tags: (it) => tags.size === 0 || it.tagsLower.some((t) => tags.has(t)),
    companies: (it) => companies.size === 0 || it.companiesLower.some((c) => companies.has(c)),
  };
}

const FACETS: Facet[] = ['q', 'difficulty', 'status', 'topic', 'tags', 'companies'];

/** One catalog page for `userId`. */
export async function listCatalog(
  userId: string,
  query: CatalogQuery,
  opts: { pageSize?: number; now?: Date } = {}
): Promise<CatalogResult> {
  const pageSize = opts.pageSize ?? CATALOG_PAGE_SIZE;
  const [questions, allTopics, progress] = await Promise.all([
    prisma.question.findMany({
      where: { status: 'published' },
      select: {
        id: true,
        slug: true,
        title: true,
        difficulty: true,
        tags: true,
        companies: true,
        topics: {
          select: {
            weight: true,
            topic: { select: { slug: true, title: true, icon: true, ord: true, tier: { select: { ord: true } } } },
          },
        },
      },
    }),
    prisma.topic.findMany({
      select: { slug: true, title: true, icon: true, ord: true, tier: { select: { ord: true, title: true } } },
      orderBy: [{ tier: { ord: 'asc' } }, { ord: 'asc' }],
    }),
    userQuestionProgress(userId),
  ]);

  const items: Item[] = questions.map((q) => ({
    id: q.id,
    slug: q.slug,
    title: q.title,
    titleLower: q.title.toLowerCase(),
    difficulty: q.difficulty,
    tags: q.tags,
    tagsLower: q.tags.map((t) => t.toLowerCase()),
    companies: q.companies,
    companiesLower: q.companies.map((c) => c.toLowerCase()),
    topics: q.topics
      .map((t) => ({
        slug: t.topic.slug,
        title: t.topic.title,
        icon: t.topic.icon,
        weight: t.weight,
        tierOrd: t.topic.tier.ord,
        ord: t.topic.ord,
      }))
      .sort((a, b) => b.weight - a.weight || a.tierOrd - b.tierOrd || a.ord - b.ord),
    status: progress.get(q.id) ?? 'todo',
  }));

  const pred = predicates(query);
  const passes = (it: Item, except?: Facet) => FACETS.every((f) => f === except || pred[f](it));

  // ── facet counts (each ignores its own filter) ──
  const difficulty = Object.fromEntries(DIFFICULTIES.map((d) => [d, 0])) as Record<Difficulty, number>;
  const status = Object.fromEntries(CATALOG_STATUSES.map((s) => [s, 0])) as Record<CatalogStatus, number>;
  const topicCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const companyCounts = new Map<string, { value: string; count: number }>();
  for (const [key, value] of companySpellings(items)) companyCounts.set(key, { value, count: 0 });
  for (const it of items) {
    for (const t of it.tagsLower) if (!tagCounts.has(t)) tagCounts.set(t, 0);
    if (passes(it, 'difficulty')) difficulty[it.difficulty]++;
    if (passes(it, 'status')) status[it.status]++;
    if (passes(it, 'topic')) for (const t of it.topics) topicCounts.set(t.slug, (topicCounts.get(t.slug) ?? 0) + 1);
    if (passes(it, 'tags')) for (const t of new Set(it.tagsLower)) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    if (passes(it, 'companies')) {
      for (const c of new Set(it.companiesLower)) companyCounts.get(c)!.count++;
    }
  }

  const matched = items.filter((it) => passes(it)).sort(compareCurriculum);
  const total = matched.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, query.page), pageCount);
  const slice = matched.slice((page - 1) * pageSize, page * pageSize);
  const ids = slice.map((it) => it.id);

  const [access, acceptance] = await Promise.all([questionAccessMap(userId, ids, opts.now), acceptanceRates(ids)]);

  const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return {
    rows: slice.map((it) => ({
      id: it.id,
      slug: it.slug,
      title: it.title,
      difficulty: it.difficulty,
      topics: it.topics.map(({ slug, title, icon }) => ({ slug, title, icon })),
      tags: it.tags,
      status: it.status,
      accessible: access.get(it.id) ?? false,
      acceptance: acceptance.get(it.id) ?? null,
    })),
    total,
    page,
    pageCount,
    pageSize,
    facets: {
      difficulty,
      status,
      topics: allTopics.map((t) => ({
        slug: t.slug,
        title: t.title,
        icon: t.icon,
        tierOrd: t.tier.ord,
        tierTitle: t.tier.title,
        count: topicCounts.get(t.slug) ?? 0,
      })),
      tags: [...tagCounts].map(([value, count]) => ({ value, count })).sort((a, b) => byName(a.value, b.value)),
      companies: [...companyCounts.values()].sort((a, b) => byName(a.value, b.value)),
    },
    summary: {
      questions: items.length,
      solved: items.filter((it) => it.status === 'solved').length,
      attempted: items.filter((it) => it.status === 'attempted').length,
    },
  };
}
