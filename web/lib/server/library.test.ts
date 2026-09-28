import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vitest.config.ts compiles .tsx with the classic JSX runtime (React.createElement),
// so TSX modules are imported dynamically below, after React is in global scope.
(globalThis as Record<string, unknown>).React = React;

vi.mock('@/lib/compile', () => {
  class CompileServiceError extends Error {
    constructor(
      public status: number,
      body: string
    ) {
      super(`compile service ${status}: ${body}`);
    }
  }
  return { compile: { executeIde: vi.fn() }, CompileServiceError };
});

import { compile, CompileServiceError } from '@/lib/compile';
import { VIZ_IDS } from '@/components/Library/viz/ids';
import { texToMathML } from '@/components/ui/tex';
import { loadLibrary } from '../../prisma/seed/load';
import {
  canViewLibrary,
  getLibraryArea,
  getLibraryArticle,
  getLibraryIndex,
  getLibraryViewer,
  libraryIsPublic,
  markRead,
  runArticleCode,
  type LibraryViewer,
} from './library';
import { prisma, setupTestDatabase } from './test/db';
import { makeQuestion, makeUser } from './test/factories';

setupTestDatabase();

const executeIde = vi.mocked(compile.executeIde);

afterEach(() => {
  vi.unstubAllEnvs();
  executeIde.mockReset();
});

describe('access', () => {
  it('is staff-only unless FEATURE_LIBRARY_PUBLIC=true', () => {
    expect(canViewLibrary('learner', false)).toBe(false);
    expect(canViewLibrary('author', false)).toBe(false);
    expect(canViewLibrary('staff', false)).toBe(true);
    expect(canViewLibrary('admin', false)).toBe(true);
    expect(canViewLibrary(null, false)).toBe(false);
    expect(canViewLibrary('learner', true)).toBe(true);
    expect(libraryIsPublic({})).toBe(false);
    expect(libraryIsPublic({ FEATURE_LIBRARY_PUBLIC: 'true' })).toBe(true);
    expect(libraryIsPublic({ FEATURE_LIBRARY_PUBLIC: '1' })).toBe(false);
  });

  it('reads the role from the database and honours the flag', async () => {
    const learner = await makeUser({ role: 'learner' });
    const staff = await makeUser({ role: 'staff' });
    vi.stubEnv('FEATURE_LIBRARY_PUBLIC', 'false');
    expect(await getLibraryViewer(learner.id)).toBeNull();
    expect(await getLibraryViewer(null)).toBeNull();
    expect(await getLibraryViewer(staff.id)).toMatchObject({ staff: true, isPublic: false });
    vi.stubEnv('FEATURE_LIBRARY_PUBLIC', 'true');
    expect(await getLibraryViewer(learner.id)).toMatchObject({ staff: false, isPublic: true });
    await prisma.user.update({ where: { id: staff.id }, data: { role: 'learner' } });
    vi.stubEnv('FEATURE_LIBRARY_PUBLIC', 'false');
    expect(await getLibraryViewer(staff.id)).toBeNull();
  });
});

async function library() {
  const area = await prisma.libraryArea.create({ data: { slug: 'graphs', title: 'Graphs', summary: 'g', icon: 'network', ord: 1 } });
  const other = await prisma.libraryArea.create({ data: { slug: 'strings', title: 'Strings', summary: 's', icon: 'code', ord: 0 } });
  const c1 = await prisma.libraryChapter.create({ data: { areaId: area.id, slug: 'paths', title: 'Paths', ord: 0 } });
  const c2 = await prisma.libraryChapter.create({ data: { areaId: area.id, slug: 'orders', title: 'Orders', ord: 1 } });
  const c3 = await prisma.libraryChapter.create({ data: { areaId: other.id, slug: 'match', title: 'Match', ord: 0 } });
  const art = (chapterId: string, slug: string, ord: number, over: object = {}) =>
    prisma.libraryArticle.create({
      data: {
        chapterId,
        slug,
        title: slug.toUpperCase(),
        summary: `${slug} summary`,
        difficulty: 'Medium',
        readingMinutes: 5,
        ideaMd: 'idea',
        codeCpp: 'int main() {}',
        applicationsMd: 'apps',
        pitfallMd: 'pits',
        status: 'published',
        ord,
        ...over,
      },
    });
  const dijkstra = await art(c1.id, 'dijkstra', 0, { practiceQuestionSlugs: ['q-b', 'missing', 'q-draft', 'q-a'], vizId: 'dijkstra' });
  const bfs = await art(c1.id, 'bfs', 1);
  const wip = await art(c1.id, 'wip', 2, { status: 'draft' });
  const topo = await art(c2.id, 'topo', 0);
  const kmp = await art(c3.id, 'kmp', 0);
  await makeQuestion({ slug: 'q-a' });
  await makeQuestion({ slug: 'q-b', difficulty: 'Hard' });
  await makeQuestion({ slug: 'q-draft', status: 'draft' });
  return { area, dijkstra, bfs, wip, topo, kmp };
}

const viewer = (id: string, staff: boolean): LibraryViewer => ({ id, role: staff ? 'staff' : 'learner', staff, isPublic: !staff });

describe('reading', () => {
  it('builds the index with per-area progress and the next unread article', async () => {
    const lib = await library();
    const u = await makeUser({ role: 'staff' });
    const v = viewer(u.id, true);
    let index = await getLibraryIndex(v);
    expect(index.areas.map((a) => [a.slug, a.articles, a.read, a.minutes, a.chapters])).toEqual([
      ['strings', 1, 0, 5, 1],
      ['graphs', 4, 0, 20, 2],
    ]);
    expect(index.totals).toEqual({ articles: 5, read: 0, minutes: 25 });
    expect(index.next).toEqual({ areaSlug: 'strings', slug: 'kmp', title: 'KMP' });

    await markRead(v, lib.kmp.id);
    await markRead(v, lib.dijkstra.id);
    index = await getLibraryIndex(v);
    expect(index.totals.read).toBe(2);
    expect(index.next).toEqual({ areaSlug: 'graphs', slug: 'bfs', title: 'BFS' });
  });

  it('hides draft articles from non-staff readers', async () => {
    const lib = await library();
    const learner = viewer((await makeUser()).id, false);
    const staff = viewer((await makeUser({ role: 'staff' })).id, true);
    expect((await getLibraryIndex(learner)).totals.articles).toBe(4);
    const area = await getLibraryArea(learner, 'graphs');
    expect(area?.chapters.map((c) => [c.slug, c.articles.map((a) => a.slug)])).toEqual([
      ['paths', ['dijkstra', 'bfs']],
      ['orders', ['topo']],
    ]);
    expect(await getLibraryArticle(learner, 'graphs', 'wip')).toBeNull();
    expect((await getLibraryArticle(staff, 'graphs', 'wip'))?.status).toBe('draft');
    expect(await markRead(learner, lib.wip.id)).toBeNull();
    expect(await prisma.libraryProgress.count()).toBe(0);
  });

  it('serves an article only under its own area, with neighbours and published practice questions', async () => {
    await library();
    const v = viewer((await makeUser({ role: 'staff' })).id, true);
    expect(await getLibraryArticle(v, 'strings', 'dijkstra')).toBeNull();
    expect(await getLibraryArticle(v, 'graphs', 'nope')).toBeNull();
    expect(await getLibraryArea(v, 'nope')).toBeNull();
    const a = await getLibraryArticle(v, 'graphs', 'bfs');
    expect(a).toMatchObject({
      chapter: { slug: 'paths', index: 1 },
      position: { index: 2, total: 4 },
      prev: { slug: 'dijkstra' },
      next: { slug: 'wip' },
    });
    const d = await getLibraryArticle(v, 'graphs', 'dijkstra');
    expect(d?.practice).toEqual([
      { slug: 'q-b', title: 'q-b', difficulty: 'Hard' },
      { slug: 'q-a', title: 'q-a', difficulty: 'Easy' },
    ]);
    expect(d?.vizId).toBe('dijkstra');
    const topo = await getLibraryArticle(v, 'graphs', 'topo');
    expect(topo).toMatchObject({ chapter: { index: 2 }, prev: { slug: 'wip' }, next: null });
  });

  it('keeps the first read time', async () => {
    const lib = await library();
    const v = viewer((await makeUser({ role: 'staff' })).id, true);
    const first = await markRead(v, lib.bfs.id);
    await new Promise((r) => setTimeout(r, 15));
    const again = await markRead(v, lib.bfs.id);
    expect(again?.readAt.getTime()).toBe(first?.readAt.getTime());
    expect((await getLibraryArticle(v, 'graphs', 'bfs'))?.readAt?.getTime()).toBe(first?.readAt.getTime());
    expect(await markRead(v, 'missing')).toBeNull();
  });
});

describe('running article code', () => {
  const v = viewer('runner', true);
  beforeEach(() => executeIde.mockReset());

  const ide = (t: object) =>
    ({ success: false, testResults: [{ input: '', expectedOutput: '', actualOutput: '', passed: false, executionTime: 1, ...t }], totalPassed: 0, totalTests: 1, totalExecutionTime: 1 }) as never;

  it('treats any finished run as OK (there is no expected output) and passes errors through', async () => {
    executeIde.mockResolvedValueOnce(ide({ status: 'WA', actualOutput: '42\n', runMs: 3.5, memoryKb: 0, compileMs: 400 }));
    expect(await runArticleCode(v, 'int main(){}', '')).toEqual({
      status: 'OK',
      stdout: '42\n',
      error: undefined,
      runtimeMs: 3.5,
      memoryKb: undefined,
      compileMs: 400,
    });
    expect(executeIde).toHaveBeenCalledWith({ language: 'cpp', code: 'int main(){}', testCases: [{ input: '', expectedOutput: '' }] });

    executeIde.mockResolvedValueOnce(ide({ status: 'CE', error: "main.cpp:1: error: expected ';'", compileMs: 90 }));
    expect(await runArticleCode(v, 'int main(', '')).toMatchObject({ status: 'CE', error: "main.cpp:1: error: expected ';'", runtimeMs: undefined });

    executeIde.mockResolvedValueOnce(ide({ status: 'TLE', runMs: 2000, memoryKb: 900 }));
    expect(await runArticleCode(v, 'int main(){for(;;);}', '')).toMatchObject({ status: 'TLE', memoryKb: 900 });

    executeIde.mockRejectedValueOnce(new CompileServiceError(502, 'down'));
    expect(await runArticleCode(v, 'int main(){}', '')).toMatchObject({ status: 'XX', error: expect.stringMatching(/unavailable \(502\)/) });
  });

  it('validates input and applies the per-user submission limit', async () => {
    expect(await runArticleCode(v, 7, '')).toMatchObject({ status: 'XX' });
    expect(await runArticleCode(v, '   ', '')).toMatchObject({ status: 'CE' });
    expect(await runArticleCode(v, 'x'.repeat(70_000), '')).toMatchObject({ status: 'CE', error: 'Code is over 64 KB.' });
    executeIde.mockResolvedValue(ide({ status: 'OK' }));
    const limited = viewer('flood', true);
    for (let i = 0; i < 30; i++) expect((await runArticleCode(limited, 'int main(){}', '')).status).toBe('OK');
    expect(await runArticleCode(limited, 'int main(){}', '')).toMatchObject({ status: 'XX', error: expect.stringMatching(/Too many attempts/) });
    expect(executeIde).toHaveBeenCalledTimes(30);
  });
});

describe('seeded library content', () => {
  const dir = fileURLToPath(new URL('../../prisma/seed/data', import.meta.url));
  const { areas, problems } = loadLibrary(dir);
  const articles = areas.flatMap((a) => a.data.chapters.flatMap((c) => c.articles));
  const questionSlugs = new Set(
    readdirSync(`${dir}/questions`).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  );

  it('has 3–4 areas and 8–12 valid articles', () => {
    expect(problems).toEqual([]);
    expect(areas.length).toBeGreaterThanOrEqual(3);
    expect(areas.length).toBeLessThanOrEqual(4);
    expect(articles.length).toBeGreaterThanOrEqual(8);
    expect(articles.length).toBeLessThanOrEqual(12);
    expect(new Set(articles.map((a) => a.slug)).size).toBe(articles.length);
  });

  it('references only registered visualizations and existing questions', () => {
    for (const a of articles) {
      if (a.viz_id) expect(VIZ_IDS, a.slug).toContain(a.viz_id);
      for (const q of a.practice_question_slugs) expect(questionSlugs.has(q), `${a.slug} → ${q}`).toBe(true);
    }
  });

  it('ships complete, portable C++ programs', () => {
    for (const a of articles) {
      expect(a.code_cpp, a.slug).toMatch(/\bint main\(\)/);
      expect(a.code_cpp, a.slug).not.toMatch(/bits\/stdc\+\+/);
      expect(a.code_cpp, a.slug).toMatch(/^#include </m);
    }
  });

  it('renders every formula with the kit’s TeX subset (no unknown commands)', () => {
    for (const a of articles) {
      if (!a.formula) continue;
      const html = renderToStaticMarkup(createElement('math', null, texToMathML(a.formula)));
      expect(html, a.slug).not.toContain('\\');
    }
  });
});

describe('markdown rendering', () => {
  it('sanitizes raw HTML and javascript: links, keeps GFM', async () => {
    const { Markdown } = await import('@/components/Library/Markdown');
    const source =
      '# Title\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) and [ok](https://example.com)\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```cpp\nint x;\n```';
    const html = renderToStaticMarkup(createElement(Markdown, null, source));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<h3');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('<table');
    expect(html).toContain('tk-ty');
  });
});

describe('visualizations match the articles’ programs', () => {
  it('computes the same results the C++ prints', async () => {
    const { dijkstraSteps } = await import('@/components/Library/viz/DijkstraViz');
    expect(dijkstraSteps().at(-1)?.dist).toEqual([0, 3, 1, 8, 10, 13]);
    const { fenwickSteps } = await import('@/components/Library/viz/FenwickViz');
    expect(fenwickSteps().at(-1)?.status).toBe('sum a[3..6] = 27');
    const { dsuSteps } = await import('@/components/Library/viz/DsuViz');
    const dsu = dsuSteps();
    expect(dsu.at(-1)).toMatchObject({ parent: [0, 0, 0, 0, 4, 4, 4, 6], components: 2 });
    expect(dsu.filter((st) => st.note.includes('Skip'))).toHaveLength(1);
    const { topoSteps } = await import('@/components/Library/viz/TopoSortViz');
    expect(topoSteps().at(-1)?.order).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const { prefixSteps } = await import('@/components/Library/viz/PrefixFunctionViz');
    expect(prefixSteps('abacabab').at(-1)?.pi).toEqual([0, 0, 1, 0, 1, 2, 3, 2]);
    const { zSteps } = await import('@/components/Library/viz/ZFunctionViz');
    expect(zSteps('aabcaabxaaz').at(-1)?.z).toEqual([0, 1, 0, 0, 3, 1, 0, 0, 2, 1, 0]);
    const { sieveSteps } = await import('@/components/Library/viz/SieveViz');
    expect(sieveSteps(50).at(-1)?.primes.size).toBe(15);
    const { powerSteps } = await import('@/components/Library/viz/BinaryExponentiationViz');
    expect(powerSteps(3, 13).at(-1)?.result).toBe(1594323);
  });
});
