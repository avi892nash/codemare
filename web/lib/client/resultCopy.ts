/**
 * The words of a result card, pure so they can be tested: the headline, the
 * one line under it, what to try, and how a reward reads. Judge vocabulary
 * stays (Accepted, Wrong answer, Time limit exceeded …); the short codes
 * (OK, WA, TLE …) are small labels beside it.
 */
import type { IconName } from '@/components/ui/Icon';
import type { TestEventData, VerdictEventData } from '@/lib/sse';
import type { Verdict } from '@/lib/types';
import { formatLimit } from './format';
import type { RunKind } from './runState';

export type ResultMode = 'question' | 'gate';

export type VerdictTone = 'ok' | 'err' | 'warn' | 'info' | 'muted';

/**
 * How a verdict looks wherever it is shown — the result card's headline, a list row, the profile, the IDE: its tone
 * (spec §8: OK ok · WA and RE err · TLE and MLE warn · CE info · XX neutral) and its glyph. One table, so a verdict
 * is the same thing on every page.
 */
export const VERDICT_LOOK: Record<Verdict, { tone: VerdictTone; icon: IconName }> = {
  OK: { tone: 'ok', icon: 'check-circle' },
  WA: { tone: 'err', icon: 'x' },
  RE: { tone: 'err', icon: 'alert' },
  TLE: { tone: 'warn', icon: 'clock' },
  MLE: { tone: 'warn', icon: 'memory' },
  CE: { tone: 'info', icon: 'code' },
  XX: { tone: 'muted', icon: 'alert-circle' },
};

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(VERDICT_LOOK, value);
}

/** "Accepted" · "Wrong answer" · "Time limit exceeded" … A passing run (samples only) reads "All tests passed". */
export function verdictTitle(status: Verdict, kind: RunKind): string {
  if (status === 'OK') return kind === 'submit' ? 'Accepted' : 'All tests passed';
  return {
    WA: 'Wrong answer',
    RE: 'Runtime error',
    TLE: 'Time limit exceeded',
    MLE: 'Memory limit exceeded',
    CE: 'Compilation error',
    XX: 'Internal error',
  }[status];
}

/** "test 3" · "test 8 (hidden)" · "test 2 (custom)". */
export function testLabel(t: Pick<TestEventData, 'idx' | 'hidden' | 'custom'>): string {
  return `test ${t.idx + 1}${t.hidden ? ' (hidden)' : t.custom ? ' (custom)' : ''}`;
}

/** The first test that did not pass (any kind), and the first visible one — the one whose input can be shown. */
export function firstFailures(tests: readonly TestEventData[]): { any: TestEventData | null; visible: TestEventData | null } {
  return { any: tests.find((t) => !t.passed) ?? null, visible: tests.find((t) => !t.passed && !t.hidden) ?? null };
}

const noun = (n: number) => `test${n === 1 ? '' : 's'}`;

/** The one line under the headline: what happened. */
export function verdictSummary(
  verdict: Pick<VerdictEventData, 'status' | 'totalPassed' | 'totalTests'>,
  kind: RunKind,
  tests: readonly TestEventData[],
  opts: { timeLimitMs?: number; mode?: ResultMode } = {}
): string {
  const { status, totalPassed, totalTests } = verdict;
  const firstFail = tests.find((t) => !t.passed);
  switch (status) {
    case 'OK':
      if (kind === 'run') return `${totalPassed} of ${totalTests} ${noun(totalTests)} passed. Submit to judge it against the hidden tests too.`;
      return `All ${totalTests} ${noun(totalTests)} passed.${opts.mode === 'gate' ? ' This counts for the gate.' : ''}`;
    case 'WA':
      return `${totalPassed} of ${totalTests} ${noun(totalTests)} passed.`;
    case 'TLE': {
      const limit = opts.timeLimitMs ? ` its ${formatLimit(opts.timeLimitMs)} limit` : ' the time limit';
      return firstFail
        ? `${totalPassed} of ${totalTests} ${noun(totalTests)} finished before the run hit${limit} on ${testLabel(firstFail)}.`
        : `The run hit${limit}.`;
    }
    case 'MLE':
      return firstFail
        ? `Ran out of memory on ${testLabel(firstFail)} (${totalPassed} of ${totalTests} passed before it).`
        : 'The run used too much memory.';
    case 'RE':
      return firstFail ? `Crashed on ${testLabel(firstFail)} — ${totalPassed} of ${totalTests} passed before it.` : 'The program crashed.';
    case 'CE':
      return 'Your code didn’t compile, so nothing ran.';
    case 'XX':
      return 'The judge couldn’t finish this run. It isn’t your code — try again.';
  }
}

/** What to try next, for the verdicts that call for it; null when the line above says it all. */
export function verdictAdvice(status: Verdict): string | null {
  switch (status) {
    case 'TLE':
      return 'Correct on what finished, but too slow for the largest inputs. Look for an asymptotically faster approach — the constraints say which complexity fits.';
    case 'MLE':
      return 'Look for a structure that doesn’t keep every intermediate result, or an in-place approach.';
    case 'RE':
      return 'Read the last line of the error: it names what went wrong, and the line numbers point into your code.';
    case 'CE':
      return 'Click a line reference to jump to it, fix it and run again.';
    default:
      return null;
  }
}

/** "+1 token" · "+3 tokens". */
export function tokenPhrase(amount: number): string {
  return `+${amount} token${amount === 1 ? '' : 's'}`;
}
