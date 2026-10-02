import { describe, expect, it } from 'vitest';
import { pageWindow } from '@/components/Filters/pageWindow';
import { fmtAbsolute, fmtMicros, fmtRelative, fmtValue } from '@/components/Submissions/format';
import {
  EMPTY_SUBMISSION_QUERY,
  hasSubmissionFilters,
  parseSubmissionQuery,
  submissionsHref,
} from '@/components/Submissions/query';

describe('submissions URL contract', () => {
  it('parses status (any case, or pending), language, kind and page', () => {
    expect(parseSubmissionQuery({ status: 'wa', language: 'Python', kind: 'RUN', page: '2' })).toEqual({
      status: 'WA',
      language: 'python',
      kind: 'run',
      page: 2,
    });
    expect(parseSubmissionQuery(new URLSearchParams('status=pending')).status).toBe('pending');
  });

  it('drops unknown values', () => {
    expect(parseSubmissionQuery({ status: 'ACCEPTED', language: 'rust', kind: 'exam', page: '0' })).toEqual(
      EMPTY_SUBMISSION_QUERY
    );
  });

  it('builds links, resetting the page on filter changes', () => {
    const q = parseSubmissionQuery({ status: 'OK', page: '3' });
    expect(submissionsHref(q, { page: 4 })).toBe('/submissions?status=OK&page=4');
    expect(submissionsHref(q, { language: 'go' })).toBe('/submissions?status=OK&language=go');
    expect(submissionsHref(EMPTY_SUBMISSION_QUERY)).toBe('/submissions');
    expect(hasSubmissionFilters(q)).toBe(true);
    expect(hasSubmissionFilters({ ...EMPTY_SUBMISSION_QUERY, page: 5 })).toBe(false);
  });
});

describe('pageWindow (the pager under the list)', () => {
  it('shows first, last and the neighbours of the current page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]);
    expect(pageWindow(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe('fmtMicros', () => {
  it('keeps sub-millisecond runs in µs and scales up from there', () => {
    expect(fmtMicros(null)).toEqual(['—', '']);
    expect(fmtMicros(0)).toEqual(['0', 'µs']);
    expect(fmtMicros(412.4)).toEqual(['412', 'µs']);
    expect(fmtMicros(999)).toEqual(['999', 'µs']);
    expect(fmtMicros(4123)).toEqual(['4.12', 'ms']);
    expect(fmtMicros(41_234)).toEqual(['41.2', 'ms']);
    expect(fmtMicros(2_004_311)).toEqual(['2.00', 's']);
    expect(fmtMicros(-5)).toEqual(['—', '']);
  });
});

describe('fmtRelative / fmtAbsolute', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const ago = (s: number) => new Date(now.getTime() - s * 1000);

  it('reads naturally for recent times and falls back to a date', () => {
    expect(fmtRelative(ago(10), now)).toBe('just now');
    expect(fmtRelative(ago(3 * 60), now)).toBe('3m ago');
    expect(fmtRelative(ago(5 * 3600), now)).toBe('5h ago');
    expect(fmtRelative(ago(2 * 86_400), now)).toBe('2d ago');
    expect(fmtRelative(new Date('2026-09-03T08:00:00Z'), now)).toBe('Sep 3');
    expect(fmtRelative(new Date('2025-12-31T08:00:00Z'), now)).toBe('Dec 31, 2025');
  });

  it('prints an absolute UTC stamp', () => {
    expect(fmtAbsolute(new Date('2026-09-28T14:03:59Z'))).toBe('2026-09-28 14:03 UTC');
  });
});

describe('fmtValue', () => {
  it('prints compact JSON and truncates long values', () => {
    expect(fmtValue([1, 2, 3])).toBe('[1,2,3]');
    expect(fmtValue('ab')).toBe('"ab"');
    expect(fmtValue(null)).toBe('null');
    expect(fmtValue(undefined)).toBe('undefined');
    const long = fmtValue('x'.repeat(1000), 50);
    expect(long.startsWith(`"${'x'.repeat(49)}…`)).toBe(true);
    expect(long).toMatch(/\(\+952 chars\)$/);
  });
});
