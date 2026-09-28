/**
 * Pure authoring rules (components/Author/model.ts): the same functions the
 * editor runs live and lib/server/author.ts re-runs before saving/publishing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  computeChecklist,
  checklistPasses,
  emptyDraft,
  fnv1a,
  generateStub,
  generateStubs,
  identifierIssue,
  normalizeTag,
  parseTest,
  parseType,
  referenceFingerprint,
  signaturePreview,
  slugify,
  testFitIssues,
  toTestDefs,
  fromTestDefs,
  valueIssue,
  type QuestionDraft,
} from '@/components/Author/model';
import { LANGUAGES, type Signature, type SupportedLanguage } from '@/lib/types';

const questionsDir = fileURLToPath(new URL('../../prisma/seed/data/questions/', import.meta.url));
const seeded = readdirSync(questionsDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(questionsDir, f), 'utf8')) as {
    slug: string;
    function_name: string;
    signature: Signature;
    starter_code: Record<SupportedLanguage, string>;
    tests: { input: unknown[]; expected: unknown }[];
  });

describe('slugify', () => {
  it('derives kebab-case slugs from titles', () => {
    expect(slugify('Two Sum')).toBe('two-sum');
    expect(slugify('  Two Sum II — Input Array Is Sorted! ')).toBe('two-sum-ii-input-array-is-sorted');
    expect(slugify("Dijkstra's Shortest Path")).toBe('dijkstras-shortest-path');
    expect(slugify('Crème brûlée & 3 friends')).toBe('creme-brulee-3-friends');
    expect(slugify('---')).toBe('');
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(80);
  });

  it('normalizes tags to the seeded kebab-case style', () => {
    expect(normalizeTag('Hash Table')).toBe('hash-table');
    expect(normalizeTag('two_pointers')).toBe('two-pointers');
  });
});

describe('identifiers', () => {
  it('accepts ordinary names and rejects keywords of any language', () => {
    expect(identifierIssue('twoSum', 'Function name')).toBeNull();
    expect(identifierIssue('nums_2', 'Parameter')).toBeNull();
    expect(identifierIssue('', 'Function name')).toMatch(/missing/);
    expect(identifierIssue('2sum', 'Function name')).toMatch(/must start/);
    expect(identifierIssue('class', 'Function name')).toMatch(/reserved in .*Python.*JavaScript.*C\+\+.*Java/);
    expect(identifierIssue('range', 'Parameter 1')).toMatch(/reserved in Go/);
    expect(identifierIssue('lambda', 'Parameter 1')).toMatch(/reserved in Python/);
    expect(identifierIssue('vector', 'Parameter 1')).toMatch(/reserved in C\+\+/);
    expect(identifierIssue('String', 'Parameter 1')).toMatch(/reserved in Java/);
    expect(identifierIssue('__cm_x', 'Parameter 1')).toMatch(/harness/);
  });
});

describe('signature types', () => {
  it('parses the 18 supported types and nothing else', () => {
    expect(parseType('int')).toEqual({ base: 'int', dims: 0 });
    expect(parseType('string[][]')).toEqual({ base: 'string', dims: 2 });
    expect(parseType('int[][][]')).toBeNull();
    expect(parseType('float')).toBeNull();
    expect(parseType('void')).toBeNull();
  });

  it('checks JSON values the way the typed harnesses embed them', () => {
    expect(valueIssue('int', 5)).toBeNull();
    expect(valueIssue('int', 2 ** 31)).toMatch(/32-bit/);
    expect(valueIssue('int', 1.5)).toMatch(/int/);
    expect(valueIssue('long', 2 ** 40)).toBeNull();
    expect(valueIssue('long', 2 ** 60)).toMatch(/2\^53/);
    expect(valueIssue('double', 1)).toBeNull();
    expect(valueIssue('bool', 0)).toMatch(/bool/);
    expect(valueIssue('char', 'ab')).toMatch(/char/);
    expect(valueIssue('char', 'é')).toMatch(/ASCII/);
    expect(valueIssue('string[]', ['a', 'b'])).toBeNull();
    expect(valueIssue('int[][]', [[1], [2, 3], []])).toBeNull();
    expect(valueIssue('int[][]', [[1], 2])).toMatch(/\[1\]: expected int\[\]/);
  });

  it('reports arity and per-argument mismatches', () => {
    const sig: Signature = { params: [{ name: 'nums', type: 'int[]' }, { name: 'k', type: 'int' }], returns: 'bool' };
    expect(testFitIssues(sig, [[1, 2], 3], true)).toEqual([]);
    expect(testFitIssues(sig, [[1, 2]], true)[0]).toMatch(/1 argument; the signature takes 2/);
    expect(testFitIssues(sig, [[1, 'x'], 3], 1)).toEqual([
      'argument 1 (nums): [1]: expected int (32-bit), got "x"',
      'expected output: expected bool, got 1',
    ]);
  });
});

describe('starter stubs', () => {
  it('reproduces every seeded question’s starter code exactly, in all six languages', () => {
    expect(seeded.length).toBeGreaterThanOrEqual(30);
    for (const q of seeded) {
      for (const lang of LANGUAGES) {
        expect(generateStub(lang, q.function_name, q.signature), `${q.slug} [${lang}]`).toBe(q.starter_code[lang]);
      }
    }
  });

  it('covers the types no seeded question uses yet', () => {
    const sig: Signature = {
      params: [
        { name: 'a', type: 'long' },
        { name: 'b', type: 'double[]' },
        { name: 'c', type: 'char' },
      ],
      returns: 'double',
    };
    const stubs = generateStubs('mix', sig);
    expect(stubs.cpp).toBe(
      '#include <vector>\nusing namespace std;\n\ndouble mix(long long a, vector<double>& b, char c) {\n    // Write your code here\n    return 0.0;\n}\n'
    );
    expect(stubs.java).toContain('public static double mix(long a, double[] b, char c) {');
    expect(stubs.java).toContain('return 0.0;');
    expect(stubs.go).toBe('func mix(a int64, b []float64, c byte) float64 {\n\t// Write your code here\n\treturn 0\n}\n');
    expect(stubs.typescript).toContain('function mix(a: number, b: number[], c: string): number {');
    expect(generateStub('java', 'f', { params: [], returns: 'char' })).toContain("return '\\0';");
    expect(generateStub('cpp', 'f', { params: [], returns: 'long[][]' })).toContain('vector<vector<long long>> f() {');
  });

  it('previews one-line signatures for the typed languages', () => {
    const sig: Signature = { params: [{ name: 'grid', type: 'int[][]' }], returns: 'int' };
    expect(signaturePreview('cpp', 'islands', sig)).toBe('int islands(vector<vector<int>>& grid)');
    expect(signaturePreview('java', 'islands', sig)).toBe('static int islands(int[][] grid)');
    expect(signaturePreview('go', 'islands', sig)).toBe('func islands(grid [][]int) int');
  });
});

describe('tests', () => {
  it('parses args (a JSON array) and expected (any JSON)', () => {
    expect(parseTest({ args: '[[1,2], 3]', expected: '[0,1]' })).toEqual({ ok: true, input: [[1, 2], 3], expected: [0, 1] });
    expect(parseTest({ args: '', expected: '1' })).toMatchObject({ ok: false, field: 'args', message: 'Arguments are empty' });
    expect(parseTest({ args: '{"a":1}', expected: '1' })).toMatchObject({ ok: false, field: 'args' });
    expect(parseTest({ args: '[1]', expected: 'nope' })).toMatchObject({ ok: false, field: 'expected' });
  });

  it('round-trips TestDefs, dropping unparseable drafts and empty explanations', () => {
    const defs = toTestDefs([
      { args: '[1]', expected: '2', hidden: false, explainOnFail: '  ' },
      { args: '[', expected: '2', hidden: true, explainOnFail: '' },
      { args: '[3]', expected: '4', hidden: true, explainOnFail: 'off by one' },
    ]);
    expect(defs).toEqual([
      { input: [1], expected: 2, hidden: false },
      { input: [3], expected: 4, hidden: true, explain_on_fail: 'off by one' },
    ]);
    expect(fromTestDefs(defs)[1]).toEqual({ args: '[3]', expected: '4', hidden: true, explainOnFail: 'off by one' });
  });
});

/** A draft that satisfies every static checklist item. */
function completeDraft(): QuestionDraft {
  const d = emptyDraft();
  d.title = 'Sum of a list';
  d.slug = 'sum-of-a-list';
  d.topics = [{ slug: 'arrays-hashing', weight: 1 }];
  d.statementMd = 'Return the sum of every number in `nums`.';
  d.examples = [{ input: 'nums = [1,2,3]', output: '6', explanation: '' }];
  d.functionName = 'sumList';
  d.params = [{ name: 'nums', type: 'int[]' }];
  d.returns = 'int';
  d.starterCode = generateStubs(d.functionName, { params: d.params, returns: d.returns });
  d.tests = [
    { args: '[[1,2,3]]', expected: '6', hidden: false, explainOnFail: '' },
    { args: '[[]]', expected: '0', hidden: true, explainOnFail: 'Empty list sums to 0' },
    { args: '[[-5]]', expected: '-5', hidden: true, explainOnFail: '' },
    { args: '[[10,20]]', expected: '30', hidden: true, explainOnFail: '' },
  ];
  d.referenceSolutions.python = 'def sumList(nums):\n    return sum(nums)\n';
  d.hints = d.hints.map((h) => ({ ...h, bodyMd: `${h.level} hint` }));
  return d;
}

describe('publish checklist', () => {
  const byKey = (d: QuestionDraft, runs?: Parameters<typeof computeChecklist>[1]) =>
    Object.fromEntries(computeChecklist(d, runs).map((i) => [i.key, i]));

  it('flags everything on an empty draft', () => {
    const items = computeChecklist(emptyDraft());
    expect(items.map((i) => i.key)).toEqual(['basics', 'statement', 'signature', 'starter', 'tests', 'reference', 'hints']);
    expect(items.every((i) => !i.ok)).toBe(true);
    expect(checklistPasses(items)).toBe(false);
  });

  it('passes once the reference has run green against the current content', () => {
    const d = completeDraft();
    const before = byKey(d);
    expect(Object.values(before).filter((i) => !i.ok).map((i) => i.key)).toEqual(['reference']);
    expect(before.reference.problems).toEqual(['Run the Python reference against the tests']);

    const run = { status: 'OK' as const, totalPassed: 4, totalTests: 4, fingerprint: referenceFingerprint(d, 'python') };
    expect(checklistPasses(computeChecklist(d, { runs: { python: run } }))).toBe(true);

    // Any change to the tests makes the run stale; whitespace does not.
    const reformatted = { ...d, tests: d.tests.map((t) => ({ ...t, args: t.args.replace(',', ', ') })) };
    expect(referenceFingerprint(reformatted, 'python')).toBe(run.fingerprint);
    const changed = { ...d, tests: [...d.tests, { args: '[[1]]', expected: '1', hidden: true, explainOnFail: '' }] };
    expect(byKey(changed, { runs: { python: run } }).reference.problems[0]).toMatch(/Re-run the Python reference/);

    const failing = { ...run, status: 'WA' as const, totalPassed: 3 };
    expect(byKey(d, { runs: { python: failing } }).reference.problems).toEqual(['Python reference fails 1 of 4 tests']);
  });

  it('requires every provided reference, not just Python', () => {
    const d = completeDraft();
    d.referenceSolutions.cpp = 'int sumList(vector<int>& nums) { return 0; }';
    const runs = { python: { status: 'OK' as const, totalPassed: 4, totalTests: 4, fingerprint: referenceFingerprint(d, 'python') } };
    expect(byKey(d, { runs }).reference.problems).toEqual(['Run the C++ reference against the tests']);
    d.referenceSolutions.python = '';
    expect(byKey(d).reference.problems[0]).toBe('A Python reference solution is required');
  });

  it('needs three hidden tests and one visible', () => {
    const d = completeDraft();
    d.tests = d.tests.map((t) => ({ ...t, hidden: true }));
    expect(byKey(d).tests.problems).toEqual(['Add at least one visible test so learners can press Run']);
    d.tests = d.tests.slice(0, 2).map((t, i) => ({ ...t, hidden: i > 0 }));
    expect(byKey(d).tests.problems).toEqual(['Add at least 3 hidden tests (1 so far)']);
  });

  it('checks the signature against every test for the typed languages', () => {
    const d = completeDraft();
    d.tests[2] = { ...d.tests[2], args: '[[1.5]]' };
    d.params = [...d.params, { name: 'range', type: 'int' }];
    const problems = byKey(d).signature.problems;
    expect(problems).toContain('Parameter 2 "range" is reserved in Go');
    expect(problems.some((p) => /^Test 1 has 1 argument; the signature takes 2/.test(p))).toBe(true);
  });

  it('checks starter code per language', () => {
    const d = completeDraft();
    d.starterCode.go = 'package main\n\nfunc sumList(nums []int) int { return 0 }\n';
    d.starterCode.java = 'class Other { static int sumList(int[] nums) { return 0; } }';
    d.starterCode.typescript = '';
    expect(byKey(d).starter.problems).toEqual([
      'Add TypeScript starter code',
      'Java starter code must declare class Solution',
      'Go starter code must not have a package clause or imports',
    ]);
  });

  it('needs all five hint levels with sane costs', () => {
    const d = completeDraft();
    d.hints[3] = { ...d.hints[3], bodyMd: ' ' };
    d.hints[4] = { ...d.hints[4], costKind: 'score', costAmount: 150 };
    expect(byKey(d).hints.problems).toEqual(['Write the key line hint', 'Solution hint: a score cost is a percentage (0–100)']);
  });

  it('checks topics against the known set', () => {
    const d = completeDraft();
    d.topics = [{ slug: 'nope', weight: 1 }, { slug: 'arrays-hashing', weight: 0 }];
    expect(byKey(d, { knownTopics: new Set(['arrays-hashing']) }).basics.problems).toEqual([
      'Unknown topic "nope"',
      'Topic "arrays-hashing" needs a weight between 0 and 10',
    ]);
  });

  it('hashes with FNV-1a', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
  });
});
