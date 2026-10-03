import { describe, expect, it } from 'vitest';
import { statusWord, submissionHeadline } from '@/components/Submissions/format';

describe("submissionHeadline / statusWord (the result card's words)", () => {
  const sub = (status: Parameters<typeof submissionHeadline>[0]['status'], over: Partial<Parameters<typeof submissionHeadline>[0]> = {}) =>
    submissionHeadline({ status, kind: 'submit', totalPassed: 4, totalTests: 9, ...over });

  it('says what happened in sentence case, with the tests passed after the dash', () => {
    expect(sub('OK', { totalPassed: 10, totalTests: 10 })).toEqual({ word: 'Accepted', rest: 'all 10 tests passed' });
    expect(sub('WA')).toEqual({ word: 'Wrong answer', rest: '4 of 9 tests passed' });
    expect(sub('TLE')).toEqual({ word: 'Time limit exceeded', rest: '4 of 9 tests passed' });
    expect(sub('MLE')).toEqual({ word: 'Memory limit exceeded', rest: '4 of 9 tests passed' });
    expect(sub('RE', { totalPassed: 0 })).toEqual({ word: 'Runtime error', rest: '0 of 9 tests passed' });
  });

  it('keeps the singular, and reads a gate attempt as a submit', () => {
    expect(sub('OK', { kind: 'gate', totalPassed: 1, totalTests: 1 })).toEqual({ word: 'Accepted', rest: 'all 1 test passed' });
    expect(sub('WA', { totalPassed: 0, totalTests: 1 })).toEqual({ word: 'Wrong answer', rest: '0 of 1 test passed' });
  });

  it('reads a run that passed as "All tests passed" (it has not been judged against the hidden tests)', () => {
    expect(sub('OK', { kind: 'run', totalPassed: 3, totalTests: 3 })).toEqual({ word: 'All tests passed', rest: null });
    expect(sub('WA', { kind: 'run', totalPassed: 1, totalTests: 3 })).toEqual({ word: 'Wrong answer', rest: '1 of 3 tests passed' });
  });

  it('has something honest to say when nothing ran or nothing is known', () => {
    expect(sub('CE', { totalPassed: 0, totalTests: 0 })).toEqual({ word: 'Compilation error', rest: 'nothing ran' });
    expect(sub('XX')).toEqual({ word: 'Internal error', rest: 'the judge couldn’t finish this run' });
    expect(sub('queued')).toEqual({ word: 'Queued', rest: 'it has not been judged yet' });
    expect(sub('running')).toEqual({ word: 'Running', rest: 'it is being judged now' });
    expect(sub('WA', { totalPassed: 0, totalTests: 0 })).toEqual({ word: 'Wrong answer', rest: null });
  });

  it('words the status for the list and the filter', () => {
    expect(statusWord('OK', 'submit')).toBe('Accepted');
    expect(statusWord('OK', 'gate')).toBe('Accepted');
    expect(statusWord('OK', 'run')).toBe('All tests passed');
    expect(statusWord('TLE', 'submit')).toBe('Time limit exceeded');
    expect(statusWord('queued', 'submit')).toBe('Queued');
    expect(statusWord('running', 'run')).toBe('Running');
  });
});
