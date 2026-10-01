import { afterEach, describe, expect, it } from 'vitest';
import type { RunEvent } from '@/lib/sse';
import { clearDraft, loadDraft, loadLanguage, saveDraft, saveLanguage } from './drafts';
import { formatCountdown, formatKb, formatLimit, formatMicros, formatMillis, formatPercent, text, timeAgo } from './format';
import { linkErrorLines } from './languages';
import { initialRunState, requestError, runReducer, type RunAction, type RunState } from './runState';
import { argumentsError, conformanceError, formatValue, namedArgs, parseArgText } from './signature';

const at = 1_000;
const ev = (event: RunEvent): RunAction => ({ type: 'event', event, at });
const reduce = (actions: RunAction[], from: RunState = initialRunState) => actions.reduce(runReducer, from);

describe('runReducer', () => {
  it('follows a stream to its verdict, keeping tests ordered by idx', () => {
    const s = reduce([
      { type: 'start', kind: 'submit', at },
      ev({ event: 'queued', data: { submissionId: 's1', totalTests: 3 } }),
      ev({ event: 'running', data: {} }),
      ev({ event: 'compiling', data: {} }), // late: never moves the phase back
      ev({ event: 'test', data: { idx: 2, passed: true, hidden: true, runtimeUs: 3, memoryKb: null } }),
      ev({ event: 'test', data: { idx: 0, passed: false, hidden: false, runtimeUs: 1, memoryKb: 1 } }),
    ]);
    expect(s).toMatchObject({ phase: 'running', kind: 'submit', submissionId: 's1', totalTests: 3 });
    expect(s.tests.map((t) => t.idx)).toEqual([0, 2]);
    const done = reduce([ev({ event: 'verdict', data: { status: 'WA', totalPassed: 1, totalTests: 3, runtimeUs: 4, memoryKb: 1, submissionId: 's1' } })], s);
    expect(done).toMatchObject({ phase: 'done', verdict: { status: 'WA' }, finishedAt: at });
    // Nothing moves a finished run.
    expect(reduce([ev({ event: 'test', data: { idx: 1, passed: true, hidden: false, runtimeUs: 1, memoryKb: 1 } }), { type: 'cancel', at }], done)).toBe(done);
  });

  it('keeps the first failure and handles cancel / reset', () => {
    const failed = reduce([
      { type: 'start', kind: 'run', at },
      ev({ event: 'error', data: { message: 'sandbox down' } }),
      { type: 'fail', at, error: { status: null, code: 'stream_closed', message: 'closed', body: null } },
    ]);
    expect(failed).toMatchObject({ phase: 'failed', error: { code: 'judge_error', message: 'sandbox down' } });
    expect(reduce([{ type: 'start', kind: 'run', at }, { type: 'cancel', at }]).phase).toBe('cancelled');
    expect(reduce([{ type: 'reset' }], failed)).toBe(initialRunState);
  });

  it('maps HTTP errors, keeping the JSON body', () => {
    expect(requestError(429, { error: 'rate_limited', message: 'Slow down', retryAfterSec: 7 })).toEqual({
      status: 429,
      code: 'rate_limited',
      message: 'Slow down',
      body: { error: 'rate_limited', message: 'Slow down', retryAfterSec: 7 },
    });
    expect(requestError(401, null).message).toMatch(/sign in/i);
    expect(requestError(502, 'x').message).toMatch(/server/);
  });
});

describe('format', () => {
  it('formats µs, ms and KB', () => {
    expect(text(formatMicros(842))).toBe('842 µs');
    expect(text(formatMicros(1240))).toBe('1.24 ms');
    expect(text(formatMicros(12_400))).toBe('12.4 ms');
    expect(text(formatMicros(2_100_000))).toBe('2.1 s');
    expect(text(formatMicros(null))).toBe('—');
    expect(text(formatMillis(340))).toBe('340 ms');
    expect(text(formatMillis(1613))).toBe('1.61 s');
    expect(text(formatKb(575))).toBe('575 KB');
    expect(text(formatKb(2208))).toBe('2.16 MB');
    expect(text(formatKb(0))).toBe('—');
    expect(formatPercent(87.5)).toBe('87.5');
    expect(formatPercent(50)).toBe('50');
    expect(formatLimit(2000)).toBe('2 s');
    expect(formatLimit(1500)).toBe('1.5 s');
    expect(formatCountdown(65_000)).toBe('1:05');
    expect(formatCountdown(3_723_000)).toBe('1:02:03');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(timeAgo(0, 10_000)).toBe('just now');
    expect(timeAgo(0, 5 * 60_000)).toBe('5m ago');
  });
});

describe('signature helpers', () => {
  const sig = { params: [{ name: 'nums', type: 'int[]' as const }, { name: 'k', type: 'char' as const }], returns: 'bool' as const };

  it('checks arity and types like the compile service', () => {
    expect(argumentsError(sig, [[1, 2], 'a'])).toBeNull();
    expect(argumentsError(sig, [[1, 2]])).toMatch(/expected 2 arguments \(nums, k\), got 1/);
    expect(argumentsError(sig, [[1, 2.5], 'a'])).toBe('nums[1]: expected an int (32-bit integer), got 2.5');
    expect(argumentsError(sig, [[1], 'ab'])).toMatch(/^k: expected a single character/);
    expect(argumentsError(sig, [[1], 'é'], 'java')).toBeNull();
    expect(conformanceError('long', 2 ** 40)).toBeNull();
    expect(conformanceError('int', 2 ** 40)).toMatch(/int/);
    expect(conformanceError('string[][]', [['a'], []])).toBeNull();
    expect(conformanceError('double', Infinity)).toMatch(/number/);
  });

  it('parses argument text and prints values', () => {
    expect(parseArgText(' [1, 2] ')).toEqual({ ok: true, value: [1, 2] });
    expect(parseArgText('abc')).toEqual({ ok: false, error: 'strings need quotes: "abc"' });
    expect(parseArgText('')).toEqual({ ok: false, error: 'empty' });
    expect(parseArgText('[1,')).toEqual({ ok: false, error: 'not valid JSON' });
    expect(formatValue([2, 7, 11, 15])).toBe('[2,7,11,15]');
    expect(formatValue('a,b')).toBe('"a,b"');
    expect(formatValue('x'.repeat(10), 4)).toMatch(/^"xxx … \(8 more chars\)$/);
    expect(namedArgs(sig, [[1], 'a'])).toEqual([
      { name: 'nums', value: [1] },
      { name: 'k', value: 'a' },
    ]);
  });
});

describe('linkErrorLines', () => {
  it.each([
    ["solution.cpp:4:14: error: expected ';'", { line: 4, column: 14, text: 'solution.cpp:4:14' }],
    ['solution.go:3:1: syntax error', { line: 3, column: 1, text: 'solution.go:3:1' }],
    ['solution.ts:3:1 - error TS1005', { line: 3, column: 1, text: 'solution.ts:3:1' }],
    ['solution.js:3\n}', { line: 3, text: 'solution.js:3' }],
    ["Main.java:3: error: ';' expected", { line: 3, text: 'Main.java:3' }],
    ['  File "solution.py", line 7\n    x = ', { line: 7, text: 'File "solution.py", line 7' }],
  ])('%s', (output, ref) => {
    const segments = linkErrorLines(output);
    expect(segments.map((s) => s.text).join('')).toBe(output);
    expect(segments.find((s) => s.line)).toMatchObject(ref);
  });

  it('leaves prelude and harness files alone', () => {
    expect(linkErrorLines('prelude_1.py:3 harness.py:9').every((s) => s.line === undefined)).toBe(true);
  });
});

describe('drafts', () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { window?: unknown };
  afterEach(() => {
    store.clear();
    delete g.window;
  });

  it('stores per scope and language, clearing drafts equal to the starter', () => {
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    saveDraft('q:1', 'python', 'print(1)', 'pass');
    saveDraft('q:1', 'go', 'func f() {}', 'func f() {}');
    expect(loadDraft('q:1', 'python')).toBe('print(1)');
    expect(loadDraft('q:1', 'go')).toBeNull();
    expect(loadDraft('q:2', 'python')).toBeNull();
    clearDraft('q:1', 'python');
    expect(loadDraft('q:1', 'python')).toBeNull();

    expect(loadLanguage('q:1')).toBeNull();
    saveLanguage('q:9', 'cpp');
    expect(loadLanguage('q:1')).toBe('cpp'); // falls back to the last language used anywhere
    expect(loadLanguage('q:1', ['python', 'go'])).toBeNull();
  });

  it('degrades to nothing when storage is unavailable', () => {
    g.window = {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    };
    expect(() => saveDraft('q:1', 'python', 'x')).not.toThrow();
    expect(loadDraft('q:1', 'python')).toBeNull();
  });
});
