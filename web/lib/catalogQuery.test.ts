import { describe, expect, it } from 'vitest';
import {
  EMPTY_CATALOG_QUERY,
  catalogHref,
  catalogSearchString,
  countFacetFilters,
  hasActiveFilters,
  pageWindow,
  parseCatalogQuery,
  searchWords,
} from '@/components/Catalog/query';

describe('parseCatalogQuery', () => {
  it('parses every facet from Next-style search params', () => {
    const q = parseCatalogQuery({
      q: '  two   sum ',
      difficulty: ['hard', 'Easy'],
      status: 'Solved',
      topic: 'Graphs',
      tag: ['Array', 'hash-table'],
      company: ['Google', '  Goldman   Sachs '],
      page: '3',
    });
    expect(q).toEqual({
      q: 'two sum',
      difficulties: ['Easy', 'Hard'],
      status: 'solved',
      topic: 'graphs',
      tags: ['array', 'hash-table'],
      companies: ['Google', 'Goldman Sachs'],
      page: 3,
    });
  });

  it('accepts comma lists for difficulty and tags, and URLSearchParams', () => {
    const q = parseCatalogQuery(new URLSearchParams('difficulty=Medium,Easy&tag=graph,bfs&tag=graph'));
    expect(q.difficulties).toEqual(['Easy', 'Medium']);
    expect(q.tags).toEqual(['graph', 'bfs']);
  });

  it('drops malformed values instead of failing', () => {
    const q = parseCatalogQuery({
      difficulty: 'Impossible',
      status: 'done',
      topic: '../etc',
      page: '-4',
      company: ['', 'x'.repeat(200)],
      q: 'x'.repeat(500),
    });
    expect(q).toEqual({ ...EMPTY_CATALOG_QUERY, q: 'x'.repeat(100) });
    expect(parseCatalogQuery({ page: 'abc' }).page).toBe(1);
    expect(parseCatalogQuery({ page: '99999999' }).page).toBe(10_000);
  });

  it('de-duplicates companies case-insensitively and caps list length', () => {
    expect(parseCatalogQuery({ company: ['Google', 'google', 'GOOGLE'] }).companies).toEqual(['Google']);
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`);
    expect(parseCatalogQuery({ tag: many }).tags).toHaveLength(20);
  });
});

describe('catalog URLs', () => {
  const query = parseCatalogQuery({ q: 'dp', difficulty: 'Medium', tag: 'array', company: 'Amazon', page: '2' });

  it('round-trips through the canonical query string', () => {
    const qs = catalogSearchString(query);
    expect(qs).toBe('q=dp&difficulty=Medium&tag=array&company=Amazon&page=2');
    expect(parseCatalogQuery(new URLSearchParams(qs))).toEqual(query);
  });

  it('resets to page 1 on any filter change but keeps it for page moves', () => {
    expect(catalogHref(query, { status: 'todo' })).toBe('/problems?q=dp&difficulty=Medium&status=todo&tag=array&company=Amazon');
    expect(catalogHref(query, { page: 3 })).toBe('/problems?q=dp&difficulty=Medium&tag=array&company=Amazon&page=3');
    expect(catalogHref(EMPTY_CATALOG_QUERY)).toBe('/problems');
  });

  it('knows when filters are active', () => {
    expect(hasActiveFilters(EMPTY_CATALOG_QUERY)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_CATALOG_QUERY, page: 4 })).toBe(false);
    expect(hasActiveFilters(query)).toBe(true);
    expect(countFacetFilters(query)).toBe(3);
  });

  it('splits search words', () => {
    expect(searchWords('  Hash   Table ')).toEqual(['hash', 'table']);
    expect(searchWords('')).toEqual([]);
  });
});

describe('pageWindow', () => {
  it('shows first, last and the neighbours of the current page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});
