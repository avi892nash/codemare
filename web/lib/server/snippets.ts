import 'server-only';
import type { RunResult } from '@/components/ui/RunnableCodeBlock';
import type { StatusCode } from '@/components/ui/StatusPill';
import { compile, CompileServiceError } from '@/lib/compile';
import { consume, retryMessage, SUBMISSION_PER_USER } from '@/lib/rateLimit';
import type { IdeExecutionResponse, Language as IdeLanguage, SupportedLanguage } from '@/lib/types';

/**
 * Runnable lesson snippets (```lang run blocks): one program, one stdin,
 * stdout back — the compile service's IDE mode with a single test case.
 * Nothing is persisted. Every run counts against the per-user submission
 * bucket shared with Run/Submit (`submit:<userId>`, SUBMISSION_PER_USER).
 */

export const MAX_SNIPPET_CODE = 50_000;
export const MAX_SNIPPET_STDIN = 10_000;
/** Output kept per stream; lessons print a few lines. */
export const MAX_SNIPPET_OUTPUT = 20_000;

const ALIASES: Record<string, SupportedLanguage> = {
  python: 'python', py: 'python', python3: 'python',
  javascript: 'javascript', js: 'javascript', node: 'javascript', mjs: 'javascript',
  typescript: 'typescript', ts: 'typescript',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp',
  java: 'java',
  go: 'go', golang: 'go',
};

const VERDICTS = new Set<string>(['OK', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'XX']);
const isVerdict = (s: string): s is StatusCode => VERDICTS.has(s);

const LABEL: Record<SupportedLanguage, string> = {
  python: 'Python', javascript: 'JavaScript', typescript: 'TypeScript', cpp: 'C++', java: 'Java', go: 'Go',
};

export function snippetLanguage(lang: string | null | undefined): SupportedLanguage | null {
  return lang ? (ALIASES[lang.trim().toLowerCase()] ?? null) : null;
}

export interface SnippetInput {
  language: string;
  code: string;
  stdin: string;
}

export type SnippetValidation =
  | { ok: true; language: SupportedLanguage; code: string; stdin: string }
  | { ok: false; error: string };

export function validateSnippet(input: Partial<SnippetInput>): SnippetValidation {
  const language = snippetLanguage(typeof input.language === 'string' ? input.language : null);
  if (!language) return { ok: false, error: 'This language cannot be run here.' };
  const code = typeof input.code === 'string' ? input.code : '';
  const stdin = typeof input.stdin === 'string' ? input.stdin : '';
  if (!code.trim()) return { ok: false, error: 'There is no code to run.' };
  if (code.length > MAX_SNIPPET_CODE) return { ok: false, error: `Code is too long (limit ${MAX_SNIPPET_CODE.toLocaleString('en-US')} characters).` };
  if (stdin.length > MAX_SNIPPET_STDIN) return { ok: false, error: `Input is too long (limit ${MAX_SNIPPET_STDIN.toLocaleString('en-US')} characters).` };
  return { ok: true, language, code, stdin };
}

function clip(s: string | undefined): string | undefined {
  if (!s) return s;
  return s.length > MAX_SNIPPET_OUTPUT ? `${s.slice(0, MAX_SNIPPET_OUTPUT)}\n… output truncated` : s;
}

/**
 * IDE response → RunnableCodeBlock result. The IDE mode compares stdout
 * with an expected output; snippets have none, so a clean exit that
 * printed something reads back as WA — that is an OK run here.
 */
export function toRunResult(res: IdeExecutionResponse): RunResult {
  const t = res.testResults[0];
  if (!t) return { status: 'XX', error: res.error || 'The code runner returned no result.' };
  // Typed without WA (legacy shape), but the IDE mode does send it.
  const raw = t.status as string | undefined;
  const status: StatusCode = raw === 'WA' || (!raw && !t.error) ? 'OK' : raw && isVerdict(raw) ? raw : 'RE';
  const failed = status !== 'OK';
  return {
    status,
    stdout: clip(t.actualOutput) || undefined,
    // Compiler and runtime messages are the program's stderr.
    stderr: failed && (status === 'RE' || status === 'CE') ? clip(t.error) : undefined,
    error: failed && status !== 'RE' && status !== 'CE' ? (t.error || statusMessage(status)) : undefined,
    runtimeMs: t.runMs,
    memoryKb: t.memoryKb,
    compileMs: t.compileMs,
  };
}

function statusMessage(status: string): string {
  switch (status) {
    case 'TLE':
      return 'Time limit exceeded — look for an infinite loop.';
    case 'MLE':
      return 'Memory limit exceeded.';
    default:
      return 'The code runner failed. Try again in a moment.';
  }
}

/** Validate, rate-limit and run a snippet for a signed-in user. Never throws. */
export async function runSnippetForUser(userId: string, input: Partial<SnippetInput>): Promise<RunResult> {
  const v = validateSnippet(input);
  if (!v.ok) return { status: 'XX', error: v.error };

  const rl = consume(`submit:${userId}`, SUBMISSION_PER_USER.limit, SUBMISSION_PER_USER.windowMs);
  if (!rl.ok) return { status: 'XX', error: retryMessage(rl.retryAfterSec) };

  try {
    const res = await compile.executeIde({
      // The IDE contract is typed for the legacy four languages; TypeScript
      // and Go go through once the compile service supports them (a 400
      // until then, reported below).
      language: v.language as IdeLanguage,
      code: v.code,
      testCases: [{ input: v.stdin, expectedOutput: '' }],
    });
    if (!res.success && res.testResults.length === 0) {
      return { status: 'XX', error: res.error || 'The code runner failed. Try again in a moment.' };
    }
    return toRunResult(res);
  } catch (err) {
    if (err instanceof CompileServiceError && err.status === 400) {
      return { status: 'XX', error: `${LABEL[v.language]} snippets can’t run yet.` };
    }
    if (err instanceof CompileServiceError && err.status === 429) {
      return { status: 'XX', error: 'The code runner is busy. Try again in a moment.' };
    }
    console.error('[snippets] run failed:', err instanceof Error ? err.message : err);
    return { status: 'XX', error: 'The code runner is unreachable right now. Try again in a moment.' };
  }
}
