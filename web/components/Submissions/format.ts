/**
 * Formatting for submission metrics and times. Pure and server-safe.
 */
import { formatKb } from '@/lib/client/format';
import { verdictTitle } from '@/lib/client/resultCopy';
import type { SubmissionKind, SubmissionStatus, SupportedLanguage } from '@/lib/types';

/**
 * Peak memory in KB → [value, unit]: `575 KB`, `2.16 MB` — the editor's
 * results formatting (lib/client/format), so a submission reads the same
 * on every page.
 */
export function fmtKb(kb: number | null | undefined): [string, string] {
  const m = formatKb(kb);
  return [m.value, m.unit];
}

/**
 * CPU time in µs → [value, unit]: `412 µs`, `4.12 ms`, `41.2 ms`, `1.24 s`.
 * Sub-millisecond runs stay in µs, which is the whole point of the judge.
 */
export function fmtMicros(us: number | null | undefined): [string, string] {
  if (us == null || !Number.isFinite(us) || us < 0) return ['—', ''];
  if (us < 1000) return [String(Math.round(us)), 'µs'];
  if (us < 10_000) return [(us / 1000).toFixed(2), 'ms'];
  if (us < 1_000_000) return [(us / 1000).toFixed(1), 'ms'];
  return [(us / 1_000_000).toFixed(2), 's'];
}

/** `3m ago`-style age; dates older than a week print as `Sep 3` / `Sep 3, 2025` (UTC). */
export function fmtRelative(date: Date, now: Date = new Date()): string {
  const s = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(s / 86_400);
  if (d < 7) return `${d}d ago`;
  const sameYear = date.getUTCFullYear() === now.getUTCFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

/** `2026-09-28 14:03 UTC` — for title attributes next to a relative time. */
export function fmtAbsolute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** File name shown on the code block header. */
export const SOLUTION_FILE: Record<SupportedLanguage, string> = {
  python: 'solution.py',
  javascript: 'solution.js',
  typescript: 'solution.ts',
  cpp: 'solution.cpp',
  java: 'Solution.java',
  go: 'solution.go',
};

/** Compact JSON for a test value, cut at `max` characters. */
export function fmtValue(value: unknown, max = 400): string {
  let text: string;
  try {
    text = value === undefined ? 'undefined' : JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} chars)` : text;
}

const testsNoun = (n: number) => `test${n === 1 ? '' : 's'}`;

/**
 * A submission's verdict in the words of the result card: a headline ("Accepted", "Wrong answer", "Time limit
 * exceeded" …) and what is left to say after the dash ("all 10 tests passed", "4 of 9 tests passed"). A run that
 * passed reads "All tests passed", as in the editor. `rest` is null when the headline says it all.
 */
export function submissionHeadline(s: {
  status: SubmissionStatus;
  kind: SubmissionKind;
  totalPassed: number;
  totalTests: number;
}): { word: string; rest: string | null } {
  switch (s.status) {
    case 'queued':
      return { word: 'Queued', rest: 'it has not been judged yet' };
    case 'running':
      return { word: 'Running', rest: 'it is being judged now' };
    case 'CE':
      return { word: verdictTitle('CE', 'submit'), rest: 'nothing ran' };
    case 'XX':
      return { word: verdictTitle('XX', 'submit'), rest: 'the judge couldn’t finish this run' };
    default: {
      const word = verdictTitle(s.status, s.kind === 'run' ? 'run' : 'submit');
      if (s.totalTests <= 0) return { word, rest: null };
      if (s.status === 'OK') {
        return s.kind === 'run' ? { word, rest: null } : { word, rest: `all ${s.totalTests} ${testsNoun(s.totalTests)} passed` };
      }
      return { word, rest: `${s.totalPassed} of ${s.totalTests} ${testsNoun(s.totalTests)} passed` };
    }
  }
}

/** The status as a short label (list rows, the filter): "Accepted" · "Wrong answer" · "Queued"; the code is separate. */
export function statusWord(status: SubmissionStatus, kind: SubmissionKind): string {
  if (status === 'queued') return 'Queued';
  if (status === 'running') return 'Running';
  return verdictTitle(status, kind === 'run' ? 'run' : 'submit');
}
