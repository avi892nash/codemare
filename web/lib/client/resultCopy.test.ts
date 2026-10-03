import { describe, expect, it } from 'vitest';
import type { TestEventData } from '@/lib/sse';
import { firstFailures, testLabel, tokenPhrase, verdictAdvice, verdictSummary, verdictTitle } from './resultCopy';

const test = (idx: number, over: Partial<TestEventData> = {}): TestEventData => ({ idx, passed: true, hidden: false, runtimeUs: 1, memoryKb: 1, ...over }) as TestEventData;

describe('verdictTitle', () => {
  it('keeps the judge’s vocabulary, in sentence case', () => {
    expect(verdictTitle('OK', 'submit')).toBe('Accepted');
    expect(verdictTitle('OK', 'run')).toBe('All tests passed');
    expect(verdictTitle('WA', 'submit')).toBe('Wrong answer');
    expect(verdictTitle('TLE', 'run')).toBe('Time limit exceeded');
    expect(verdictTitle('MLE', 'run')).toBe('Memory limit exceeded');
    expect(verdictTitle('RE', 'submit')).toBe('Runtime error');
    expect(verdictTitle('CE', 'submit')).toBe('Compilation error');
    expect(verdictTitle('XX', 'run')).toBe('Internal error');
  });
});

describe('verdictSummary', () => {
  const tests = [test(0), test(1, { passed: false }), test(2, { hidden: true, passed: false })];

  it('says in one line how many tests passed', () => {
    expect(verdictSummary({ status: 'OK', totalPassed: 8, totalTests: 8 }, 'submit', [])).toBe('All 8 tests passed.');
    expect(verdictSummary({ status: 'OK', totalPassed: 1, totalTests: 1 }, 'submit', [])).toBe('All 1 test passed.');
    expect(verdictSummary({ status: 'WA', totalPassed: 4, totalTests: 8 }, 'submit', tests)).toBe('4 of 8 tests passed.');
    expect(verdictSummary({ status: 'OK', totalPassed: 3, totalTests: 3 }, 'run', [])).toBe('3 of 3 tests passed. Submit to judge it against the hidden tests too.');
  });

  it('says a gate submission counts for the gate', () => {
    expect(verdictSummary({ status: 'OK', totalPassed: 8, totalTests: 8 }, 'submit', [], { mode: 'gate' })).toBe('All 8 tests passed. This counts for the gate.');
    // …but a wrong answer in a gate is just a wrong answer
    expect(verdictSummary({ status: 'WA', totalPassed: 4, totalTests: 8 }, 'submit', tests, { mode: 'gate' })).toBe('4 of 8 tests passed.');
  });

  it('explains what happened for the slow, the hungry, the crashing and the uncompilable', () => {
    expect(verdictSummary({ status: 'TLE', totalPassed: 1, totalTests: 3 }, 'run', tests, { timeLimitMs: 2000 })).toBe('1 of 3 tests finished before the run hit its 2 s limit on test 2.');
    expect(verdictSummary({ status: 'TLE', totalPassed: 0, totalTests: 3 }, 'run', [])).toBe('The run hit the time limit.');
    expect(verdictSummary({ status: 'MLE', totalPassed: 1, totalTests: 3 }, 'run', tests)).toBe('Ran out of memory on test 2 (1 of 3 passed before it).');
    expect(verdictSummary({ status: 'RE', totalPassed: 1, totalTests: 3 }, 'run', tests)).toBe('Crashed on test 2 — 1 of 3 passed before it.');
    expect(verdictSummary({ status: 'RE', totalPassed: 0, totalTests: 3 }, 'run', [])).toBe('The program crashed.');
    expect(verdictSummary({ status: 'CE', totalPassed: 0, totalTests: 0 }, 'run', [])).toBe('Your code didn’t compile, so nothing ran.');
    expect(verdictSummary({ status: 'XX', totalPassed: 0, totalTests: 0 }, 'run', [])).toBe('The judge couldn’t finish this run. It isn’t your code — try again.');
  });
});

describe('verdictAdvice', () => {
  it('offers what to try for the verdicts that call for it, and nothing for the rest', () => {
    for (const status of ['TLE', 'MLE', 'RE', 'CE'] as const) expect(verdictAdvice(status), status).toEqual(expect.any(String));
    expect(verdictAdvice('TLE')).toContain('asymptotically faster');
    expect(verdictAdvice('CE')).toContain('line reference');
    for (const status of ['OK', 'WA', 'XX'] as const) expect(verdictAdvice(status), status).toBeNull();
  });
});

describe('testLabel and firstFailures', () => {
  it('names a test by its place and kind', () => {
    expect(testLabel(test(2))).toBe('test 3');
    expect(testLabel(test(7, { hidden: true }))).toBe('test 8 (hidden)');
    expect(testLabel(test(0, { custom: true }))).toBe('test 1 (custom)');
  });

  it('finds the first failure, and the first one whose input can be shown', () => {
    const all = [test(0), test(1, { passed: false, hidden: true }), test(2, { passed: false })];
    expect(firstFailures(all)).toEqual({ any: all[1], visible: all[2] });
    expect(firstFailures([test(0), test(1)])).toEqual({ any: null, visible: null });
    expect(firstFailures([test(0), test(1, { passed: false, hidden: true })])).toEqual({ any: expect.objectContaining({ idx: 1 }), visible: null });
  });
});

describe('tokenPhrase', () => {
  it('pluralises', () => {
    expect(tokenPhrase(1)).toBe('+1 token');
    expect(tokenPhrase(2)).toBe('+2 tokens');
  });
});
