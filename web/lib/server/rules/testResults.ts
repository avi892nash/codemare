/**
 * Pure per-test result shaping (spec §2 test_results, §4 SSE `test` event).
 *
 * Invariants:
 *   · hidden tests never expose input / expected / actual
 *   · explain_on_fail only travels with a failed test
 */
import type { Verdict } from '@/lib/types';

/** One judged test: the backend's result joined with its TestDef. */
export interface TestOutcome {
  /** Position in the question's test list. */
  idx: number;
  passed: boolean;
  hidden: boolean;
  /** CPU µs (backend `runUs`). */
  runtimeUs?: number | null;
  memoryKb?: number | null;
  input?: unknown;
  expected?: unknown;
  actual?: unknown;
  error?: string | null;
  /** The TestDef's `explain_on_fail`. */
  explainOnFail?: string | null;
}

/** What may leave the server (SSE `test` event data, submission detail). */
export interface PublicTestResult {
  idx: number;
  passed: boolean;
  hidden: boolean;
  runtimeUs: number | null;
  memoryKb: number | null;
  input?: unknown;
  expected?: unknown;
  actual?: unknown;
  error?: string;
  explainOnFail?: string;
}

/** Strip what a learner must not see. Also the shape stored in app.test_results. */
export function sanitizeTestOutcome(t: TestOutcome): PublicTestResult {
  const out: PublicTestResult = {
    idx: t.idx,
    passed: t.passed,
    hidden: t.hidden,
    runtimeUs: t.runtimeUs == null ? null : Math.round(t.runtimeUs),
    memoryKb: t.memoryKb == null ? null : Math.round(t.memoryKb),
  };
  if (!t.hidden) {
    if (t.input !== undefined) out.input = t.input;
    if (t.expected !== undefined) out.expected = t.expected;
    if (t.actual !== undefined) out.actual = t.actual;
  }
  if (t.error) out.error = t.error;
  if (!t.passed && t.explainOnFail) out.explainOnFail = t.explainOnFail;
  return out;
}

/** Submission totals: passed/total, runtime = Σ per-test CPU µs, memory = max per test. */
export function summarizeOutcomes(tests: readonly TestOutcome[]): {
  totalPassed: number;
  totalTests: number;
  runtimeUs: number | null;
  memoryKb: number | null;
} {
  const runtimes = tests.map((t) => t.runtimeUs).filter((v): v is number => v != null);
  const memories = tests.map((t) => t.memoryKb).filter((v): v is number => v != null);
  return {
    totalPassed: tests.filter((t) => t.passed).length,
    totalTests: tests.length,
    runtimeUs: runtimes.length ? Math.round(runtimes.reduce((a, b) => a + b, 0)) : null,
    memoryKb: memories.length ? Math.round(Math.max(...memories)) : null,
  };
}

/**
 * Never record `OK` unless every test passed (defense in depth against a
 * judge reporting OK for a failing run). Other verdicts pass through.
 */
export function normalizeVerdict(status: Verdict, totalPassed: number, totalTests: number): Verdict {
  if (status === 'OK' && (totalTests === 0 || totalPassed < totalTests)) return 'WA';
  return status;
}
