/**
 * Display names, Monaco ids and file names per language, and the parser that
 * turns "solution.cpp:4:14" / `File "solution.py", line 3` in judge output
 * into links back to the learner's own lines. Pure.
 */
import { LANGUAGES, type SupportedLanguage } from '@/lib/types';

export const LANGUAGE_META: Record<SupportedLanguage, { label: string; monaco: string; ext: string }> = {
  python: { label: 'Python', monaco: 'python', ext: 'py' },
  javascript: { label: 'JavaScript', monaco: 'javascript', ext: 'js' },
  typescript: { label: 'TypeScript', monaco: 'typescript', ext: 'ts' },
  cpp: { label: 'C++', monaco: 'cpp', ext: 'cpp' },
  java: { label: 'Java', monaco: 'java', ext: 'java' },
  go: { label: 'Go', monaco: 'go', ext: 'go' },
};

export function languageLabel(language: string): string {
  return (LANGUAGE_META as Record<string, { label: string }>)[language]?.label ?? language;
}

export function isSupportedLanguage(v: unknown): v is SupportedLanguage {
  return typeof v === 'string' && (LANGUAGES as readonly string[]).includes(v);
}

/** A piece of judge output: plain text, or a reference to a line of the learner's code. */
export type OutputSegment = { text: string; line?: number; column?: number };

// solution.cpp:4:14 · solution.go:3:1 · solution.ts:3:1 · solution.js:3 · Main.java:3
const COLON_REF = /\b(?:solution\.(?:py|js|ts|cpp|go|java)|Main\.java):(\d+)(?::(\d+))?/g;
// File "solution.py", line 3
const PY_REF = /File "solution\.py", line (\d+)/g;

/**
 * Split judge output into segments, marking every reference to a line of
 * the learner's file (never the harness or a prelude file).
 */
export function linkErrorLines(output: string): OutputSegment[] {
  const refs: { start: number; end: number; line: number; column?: number }[] = [];
  for (const re of [COLON_REF, PY_REF]) {
    re.lastIndex = 0;
    for (const m of output.matchAll(re)) {
      const line = Number(m[1]);
      if (!Number.isInteger(line) || line < 1) continue;
      const column = m[2] ? Number(m[2]) : undefined;
      refs.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, line, column });
    }
  }
  refs.sort((a, b) => a.start - b.start);
  const out: OutputSegment[] = [];
  let at = 0;
  for (const r of refs) {
    if (r.start < at) continue; // overlapping match
    if (r.start > at) out.push({ text: output.slice(at, r.start) });
    out.push({ text: output.slice(r.start, r.end), line: r.line, ...(r.column ? { column: r.column } : {}) });
    at = r.end;
  }
  if (at < output.length) out.push({ text: output.slice(at) });
  return out;
}
