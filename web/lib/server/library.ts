import 'server-only';
import { compile, CompileServiceError } from '@/lib/compile';
import { consume, retryMessage, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import type { Difficulty, PublishStatus, Role } from '@/lib/types';
import type { RunResult } from '@/components/ui/RunnableCodeBlock';
import { prisma } from './db';
import { markArticleRead } from './learn';
import { hasRole } from './rules/roles';

/**
 * The hidden algorithms Library (implementation prompt §7, spec §3.9).
 * Server-only.
 *
 *   · access: role ≥ staff, unless FEATURE_LIBRARY_PUBLIC=true (then any
 *     signed-in user). Everyone else gets a plain 404 from the pages.
 *   · reads: the index with reading progress (app.library_progress), an
 *     area's chapters, one article with its practice questions and
 *     neighbours. Draft articles are visible to staff only.
 *   · writes: marking an article read (markArticleRead), running an
 *     article's C++ through the compile service (rate-limited per user,
 *     sharing the Run/Submit bucket).
 */

// ─── Access ──────────────────────────────────────────────────────────────

export function libraryIsPublic(env: Record<string, string | undefined> = process.env): boolean {
  return env.FEATURE_LIBRARY_PUBLIC === 'true';
}

/** Staff and admins always; everyone signed in once the flag makes it public. */
export function canViewLibrary(role: Role | null | undefined, isPublic: boolean): boolean {
  return isPublic || hasRole(role, 'staff');
}

export interface LibraryViewer {
  id: string;
  role: Role;
  /** Staff+ also see draft articles. */
  staff: boolean;
  /** The library is visible to learners too (FEATURE_LIBRARY_PUBLIC). */
  isPublic: boolean;
}

/** The signed-in user if they may see the library (role read fresh from the database), else null. */
export async function getLibraryViewer(userId: string | null | undefined): Promise<LibraryViewer | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) return null;
  const isPublic = libraryIsPublic();
  if (!canViewLibrary(user.role, isPublic)) return null;
  return { id: user.id, role: user.role, staff: hasRole(user.role, 'staff'), isPublic };
}

const visible = (viewer: LibraryViewer) => (viewer.staff ? {} : { status: 'published' as const });

// ─── Index ───────────────────────────────────────────────────────────────

export interface ArticleLink {
  areaSlug: string;
  slug: string;
  title: string;
}

export interface AreaCard {
  slug: string;
  title: string;
  summary: string;
  icon: string;
  chapters: number;
  articles: number;
  read: number;
  minutes: number;
}

export interface LibraryIndex {
  areas: AreaCard[];
  totals: { articles: number; read: number; minutes: number };
  /** The first unread article in reading order (null when everything is read). */
  next: ArticleLink | null;
}

type ArticleOrderRow = {
  id: string;
  slug: string;
  title: string;
  readingMinutes: number;
  chapter: { ord: number; area: { slug: string; ord: number } };
  ord: number;
};

function readingOrder<T extends ArticleOrderRow>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      a.chapter.area.ord - b.chapter.area.ord ||
      a.chapter.area.slug.localeCompare(b.chapter.area.slug) ||
      a.chapter.ord - b.chapter.ord ||
      a.ord - b.ord
  );
}

async function readSet(userId: string, articleIds: string[]): Promise<Map<string, Date>> {
  if (articleIds.length === 0) return new Map();
  const rows = await prisma.libraryProgress.findMany({
    where: { userId, articleId: { in: articleIds } },
    select: { articleId: true, readAt: true },
  });
  return new Map(rows.map((r) => [r.articleId, r.readAt]));
}

export async function getLibraryIndex(viewer: LibraryViewer): Promise<LibraryIndex> {
  const [areas, articles] = await Promise.all([
    prisma.libraryArea.findMany({
      orderBy: [{ ord: 'asc' }, { slug: 'asc' }],
      select: { id: true, slug: true, title: true, summary: true, icon: true, _count: { select: { chapters: true } } },
    }),
    prisma.libraryArticle.findMany({
      where: visible(viewer),
      select: {
        id: true,
        slug: true,
        title: true,
        readingMinutes: true,
        ord: true,
        chapter: { select: { ord: true, area: { select: { id: true, slug: true, ord: true } } } },
      },
    }),
  ]);
  const read = await readSet(viewer.id, articles.map((a) => a.id));
  const cards: AreaCard[] = areas.map((area) => {
    const mine = articles.filter((a) => a.chapter.area.id === area.id);
    return {
      slug: area.slug,
      title: area.title,
      summary: area.summary,
      icon: area.icon,
      chapters: area._count.chapters,
      articles: mine.length,
      read: mine.filter((a) => read.has(a.id)).length,
      minutes: mine.reduce((n, a) => n + a.readingMinutes, 0),
    };
  });
  const firstUnread = readingOrder(articles).find((a) => !read.has(a.id));
  return {
    areas: cards.filter((c) => c.articles > 0),
    totals: {
      articles: articles.length,
      read: articles.filter((a) => read.has(a.id)).length,
      minutes: articles.reduce((n, a) => n + a.readingMinutes, 0),
    },
    next: firstUnread ? { areaSlug: firstUnread.chapter.area.slug, slug: firstUnread.slug, title: firstUnread.title } : null,
  };
}

// ─── Area ────────────────────────────────────────────────────────────────

export interface ArticleRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  readingMinutes: number;
  status: PublishStatus;
  hasViz: boolean;
  hasFormula: boolean;
  practice: number;
  readAt: Date | null;
}

export interface AreaDetail {
  slug: string;
  title: string;
  summary: string;
  icon: string;
  chapters: { slug: string; title: string; articles: ArticleRow[] }[];
  totals: { articles: number; read: number; minutes: number };
  next: ArticleLink | null;
}

export async function getLibraryArea(viewer: LibraryViewer, areaSlug: string): Promise<AreaDetail | null> {
  const area = await prisma.libraryArea.findUnique({
    where: { slug: areaSlug },
    select: {
      slug: true,
      title: true,
      summary: true,
      icon: true,
      chapters: {
        orderBy: { ord: 'asc' },
        select: {
          slug: true,
          title: true,
          articles: {
            where: visible(viewer),
            orderBy: { ord: 'asc' },
            select: {
              id: true,
              slug: true,
              title: true,
              summary: true,
              difficulty: true,
              readingMinutes: true,
              status: true,
              vizId: true,
              formula: true,
              practiceQuestionSlugs: true,
            },
          },
        },
      },
    },
  });
  if (!area) return null;
  const all = area.chapters.flatMap((c) => c.articles);
  if (all.length === 0) return null;
  const read = await readSet(viewer.id, all.map((a) => a.id));
  const chapters = area.chapters
    .filter((c) => c.articles.length > 0)
    .map((c) => ({
      slug: c.slug,
      title: c.title,
      articles: c.articles.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        summary: a.summary,
        difficulty: a.difficulty,
        readingMinutes: a.readingMinutes,
        status: a.status,
        hasViz: !!a.vizId,
        hasFormula: !!a.formula,
        practice: a.practiceQuestionSlugs.length,
        readAt: read.get(a.id) ?? null,
      })),
    }));
  const firstUnread = chapters.flatMap((c) => c.articles).find((a) => !a.readAt);
  return {
    slug: area.slug,
    title: area.title,
    summary: area.summary,
    icon: area.icon,
    chapters,
    totals: {
      articles: all.length,
      read: all.filter((a) => read.has(a.id)).length,
      minutes: all.reduce((n, a) => n + a.readingMinutes, 0),
    },
    next: firstUnread ? { areaSlug: area.slug, slug: firstUnread.slug, title: firstUnread.title } : null,
  };
}

// ─── Article ─────────────────────────────────────────────────────────────

export interface PracticeQuestion {
  slug: string;
  title: string;
  difficulty: Difficulty;
}

export interface ArticleDetail {
  id: string;
  slug: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  readingMinutes: number;
  status: PublishStatus;
  ideaMd: string;
  formula: string | null;
  codeCpp: string;
  vizId: string | null;
  applicationsMd: string;
  pitfallMd: string;
  area: { slug: string; title: string; icon: string };
  chapter: { slug: string; title: string; index: number };
  /** Position in the area's reading order (1-based). */
  position: { index: number; total: number };
  practice: PracticeQuestion[];
  readAt: Date | null;
  prev: ArticleLink | null;
  next: ArticleLink | null;
}

/**
 * One article, only through the area it belongs to (a slug under the wrong
 * area is a 404). Practice links resolve to published questions only, in
 * the article's order.
 */
export async function getLibraryArticle(viewer: LibraryViewer, areaSlug: string, articleSlug: string): Promise<ArticleDetail | null> {
  const article = await prisma.libraryArticle.findUnique({
    where: { slug: articleSlug },
    include: { chapter: { select: { slug: true, title: true, ord: true, area: { select: { id: true, slug: true, title: true, icon: true } } } } },
  });
  if (!article || article.chapter.area.slug !== areaSlug) return null;
  if (article.status !== 'published' && !viewer.staff) return null;

  const [siblings, questions, progress] = await Promise.all([
    prisma.libraryArticle.findMany({
      where: { ...visible(viewer), chapter: { areaId: article.chapter.area.id } },
      select: { id: true, slug: true, title: true, readingMinutes: true, ord: true, chapter: { select: { ord: true, area: { select: { slug: true, ord: true } } } } },
    }),
    article.practiceQuestionSlugs.length
      ? prisma.question.findMany({
          where: { slug: { in: article.practiceQuestionSlugs }, status: 'published' },
          select: { slug: true, title: true, difficulty: true },
        })
      : Promise.resolve([]),
    prisma.libraryProgress.findUnique({
      where: { userId_articleId: { userId: viewer.id, articleId: article.id } },
      select: { readAt: true },
    }),
  ]);
  const order = readingOrder(siblings);
  const i = order.findIndex((a) => a.id === article.id);
  const link = (a: (typeof order)[number] | undefined): ArticleLink | null =>
    a ? { areaSlug, slug: a.slug, title: a.title } : null;
  const chapterIndex = await prisma.libraryChapter.count({
    where: { areaId: article.chapter.area.id, ord: { lt: article.chapter.ord } },
  });

  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    difficulty: article.difficulty,
    readingMinutes: article.readingMinutes,
    status: article.status,
    ideaMd: article.ideaMd,
    formula: article.formula,
    codeCpp: article.codeCpp,
    vizId: article.vizId,
    applicationsMd: article.applicationsMd,
    pitfallMd: article.pitfallMd,
    area: { slug: article.chapter.area.slug, title: article.chapter.area.title, icon: article.chapter.area.icon },
    chapter: { slug: article.chapter.slug, title: article.chapter.title, index: chapterIndex + 1 },
    position: { index: i + 1, total: order.length },
    practice: article.practiceQuestionSlugs.flatMap((slug) => questions.filter((q) => q.slug === slug)),
    readAt: progress?.readAt ?? null,
    prev: link(order[i - 1]),
    next: link(order[i + 1]),
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────

/** Mark an article read for the viewer (first read time is kept). Null when it is not theirs to see. */
export async function markRead(viewer: LibraryViewer, articleId: string): Promise<{ readAt: Date } | null> {
  const article = await prisma.libraryArticle.findUnique({ where: { id: articleId }, select: { id: true, status: true } });
  if (!article || (article.status !== 'published' && !viewer.staff)) return null;
  await markArticleRead(viewer.id, articleId);
  const row = await prisma.libraryProgress.findUniqueOrThrow({
    where: { userId_articleId: { userId: viewer.id, articleId } },
    select: { readAt: true },
  });
  return { readAt: row.readAt };
}

export const MAX_CODE_BYTES = 64 * 1024;
export const MAX_STDIN_BYTES = 16 * 1024;

const PASSTHROUGH = new Set(['CE', 'RE', 'TLE', 'MLE', 'XX']);

/**
 * Compile and run an article's (possibly edited) C++ with stdin through the
 * compile service's IDE endpoint. The per-user submission limit applies.
 * There is no expected output, so any finished run is OK unless the
 * sandbox reports a compile/runtime/limit error.
 */
export async function runArticleCode(viewer: LibraryViewer, code: unknown, stdin: unknown): Promise<RunResult> {
  if (typeof code !== 'string' || typeof stdin !== 'string') return { status: 'XX', error: 'Malformed request.' };
  if (!code.trim()) return { status: 'CE', error: 'There is no code to run.' };
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) return { status: 'CE', error: 'Code is over 64 KB.' };
  if (Buffer.byteLength(stdin, 'utf8') > MAX_STDIN_BYTES) return { status: 'XX', error: 'Input is over 16 KB.' };

  const limit = consume(`submit:${viewer.id}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
  if (!limit.ok) return { status: 'XX', error: retryMessage(limit.retryAfterSec) };

  try {
    const res = await compile.executeIde({ language: 'cpp', code, testCases: [{ input: stdin, expectedOutput: '' }] });
    const t = res.testResults?.[0];
    if (!t) return { status: 'XX', error: res.error ?? 'The judge returned no result.' };
    const status = t.status && PASSTHROUGH.has(t.status) ? (t.status as RunResult['status']) : 'OK';
    return {
      status,
      stdout: t.actualOutput ?? '',
      error: status === 'OK' ? undefined : t.error ?? res.error,
      runtimeMs: status === 'CE' ? undefined : t.runMs,
      // The local dev sandbox cannot measure memory and reports 0: show nothing rather than "0 KB".
      memoryKb: status === 'CE' || !t.memoryKb ? undefined : t.memoryKb,
      compileMs: t.compileMs,
    };
  } catch (e) {
    return {
      status: 'XX',
      error:
        e instanceof CompileServiceError
          ? `The judge is unavailable (${e.status}). Try again in a moment.`
          : 'The judge is unreachable. Try again in a moment.',
    };
  }
}
