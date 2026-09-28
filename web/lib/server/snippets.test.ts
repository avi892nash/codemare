import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdeExecutionResponse } from '@/lib/types';

const executeIde = vi.fn();
vi.mock('@/lib/compile', () => {
  class CompileServiceError extends Error {
    constructor(
      public status: number,
      body: string
    ) {
      super(`compile service ${status}: ${body}`);
    }
  }
  return { compile: { executeIde: (...a: unknown[]) => executeIde(...a) }, CompileServiceError };
});

const { runSnippetForUser, snippetLanguage, toRunResult, validateSnippet, MAX_SNIPPET_CODE } = await import('./snippets');
const { CompileServiceError } = await import('@/lib/compile');
const { SUBMISSION_PER_USER } = await import('@/lib/rateLimit');

const ide = (over: Partial<IdeExecutionResponse['testResults'][number]> = {}, top: Partial<IdeExecutionResponse> = {}): IdeExecutionResponse => ({
  success: false,
  totalPassed: 0,
  totalTests: 1,
  totalExecutionTime: 12,
  testResults: [
    { input: '', expectedOutput: '', actualOutput: 'hello\n', passed: false, executionTime: 4, runMs: 1.25, memoryKb: 9000, status: 'WA' as never, ...over },
  ],
  ...top,
});

let uid = 0;
const user = () => `user-${++uid}`;

beforeEach(() => executeIde.mockReset());

describe('validateSnippet', () => {
  it('normalizes language aliases and rejects unknown ones', () => {
    expect(snippetLanguage('py')).toBe('python');
    expect(snippetLanguage('C++')).toBe('cpp');
    expect(snippetLanguage('golang')).toBe('go');
    expect(snippetLanguage('rust')).toBeNull();
    expect(validateSnippet({ language: 'brainfuck', code: 'x', stdin: '' })).toEqual({ ok: false, error: 'This language cannot be run here.' });
  });

  it('rejects empty, oversized and non-string input', () => {
    expect(validateSnippet({ language: 'python', code: '   ', stdin: '' }).ok).toBe(false);
    expect(validateSnippet({ language: 'python', code: 'x'.repeat(MAX_SNIPPET_CODE + 1), stdin: '' }).ok).toBe(false);
    expect(validateSnippet({ language: 'python', code: 'print(1)', stdin: 'x'.repeat(10_001) }).ok).toBe(false);
    expect(validateSnippet({ language: 'python', code: { evil: true } as unknown as string, stdin: '' }).ok).toBe(false);
    expect(validateSnippet({ language: 'python', code: 'print(1)', stdin: 5 as unknown as string })).toEqual({
      ok: true,
      language: 'python',
      code: 'print(1)',
      stdin: '',
    });
  });
});

describe('toRunResult', () => {
  it('treats a clean exit as OK (snippets have no expected output)', () => {
    expect(toRunResult(ide())).toEqual({ status: 'OK', stdout: 'hello\n', stderr: undefined, error: undefined, runtimeMs: 1.25, memoryKb: 9000, compileMs: undefined });
    expect(toRunResult(ide({ actualOutput: '', status: 'OK', passed: true })).status).toBe('OK');
  });

  it('reports runtime and compile errors as stderr, other failures as errors', () => {
    expect(toRunResult(ide({ status: 'RE', error: 'Traceback: ZeroDivisionError' }))).toMatchObject({ status: 'RE', stderr: 'Traceback: ZeroDivisionError' });
    expect(toRunResult(ide({ status: 'CE', actualOutput: '', error: 'expected ;' }))).toMatchObject({ status: 'CE', stderr: 'expected ;', stdout: undefined });
    expect(toRunResult(ide({ status: 'TLE', error: undefined }))).toMatchObject({ status: 'TLE', error: expect.stringMatching(/Time limit/) });
    expect(toRunResult(ide({ status: 'BOGUS' as never, error: 'x' })).status).toBe('RE');
    expect(toRunResult({ ...ide(), testResults: [], error: 'boom' })).toEqual({ status: 'XX', error: 'boom' });
  });

  it('strips terminal escape sequences (colored console.log output)', () => {
    const colored = '[ \u001b[33m4\u001b[39m, \u001b[33m5\u001b[39m ]\n\u001b]0;title\u0007done\u001b[2K';
    expect(toRunResult(ide({ actualOutput: colored })).stdout).toBe('[ 4, 5 ]\ndone');
    expect(toRunResult(ide({ status: 'RE', error: '\u001b[31mTypeError\u001b[0m: x' })).stderr).toBe('TypeError: x');
  });

  it('truncates huge output', () => {
    const r = toRunResult(ide({ actualOutput: 'y'.repeat(50_000) }));
    expect(r.stdout!.length).toBeLessThan(21_000);
    expect(r.stdout).toMatch(/output truncated$/);
  });
});

describe('runSnippetForUser', () => {
  it('runs one test case with the stdin and no expected output', async () => {
    executeIde.mockResolvedValue(ide());
    const r = await runSnippetForUser(user(), { language: 'py', code: 'print(input())', stdin: 'hello' });
    expect(r.status).toBe('OK');
    expect(executeIde).toHaveBeenCalledWith({ language: 'python', code: 'print(input())', testCases: [{ input: 'hello', expectedOutput: '' }] });
  });

  it('does not call the service for invalid input', async () => {
    const r = await runSnippetForUser(user(), { language: 'python', code: '' });
    expect(r).toEqual({ status: 'XX', error: 'There is no code to run.' });
    expect(executeIde).not.toHaveBeenCalled();
  });

  it('shares the per-user submission bucket and stops at its limit', async () => {
    executeIde.mockResolvedValue(ide());
    const u = user();
    for (let i = 0; i < SUBMISSION_PER_USER.limit; i++) {
      expect((await runSnippetForUser(u, { language: 'python', code: 'print(1)', stdin: '' })).status).toBe('OK');
    }
    const blocked = await runSnippetForUser(u, { language: 'python', code: 'print(1)', stdin: '' });
    expect(blocked.status).toBe('XX');
    expect(blocked.error).toMatch(/Too many attempts/);
    expect(executeIde).toHaveBeenCalledTimes(SUBMISSION_PER_USER.limit);
    // another user is unaffected
    expect((await runSnippetForUser(user(), { language: 'python', code: 'print(1)', stdin: '' })).status).toBe('OK');
  });

  it('turns service failures into friendly errors without throwing', async () => {
    executeIde.mockRejectedValueOnce(new CompileServiceError(400, 'Invalid language'));
    expect((await runSnippetForUser(user(), { language: 'go', code: 'x', stdin: '' })).error).toBe('Go snippets can’t run yet.');
    executeIde.mockRejectedValueOnce(new CompileServiceError(429, 'slow down'));
    expect((await runSnippetForUser(user(), { language: 'python', code: 'x', stdin: '' })).error).toMatch(/busy/);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    executeIde.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await runSnippetForUser(user(), { language: 'python', code: 'x', stdin: '' })).error).toMatch(/unreachable/);
    spy.mockRestore();
    executeIde.mockResolvedValueOnce({ success: false, testResults: [], totalPassed: 0, totalTests: 1, totalExecutionTime: 0, error: 'sandbox down' });
    expect(await runSnippetForUser(user(), { language: 'python', code: 'x', stdin: '' })).toEqual({ status: 'XX', error: 'sandbox down' });
  });
});
