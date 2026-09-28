import { Language } from './ExecutionResult.js';
import { CompareMode, ProblemSignature } from './Problem.js';

/**
 * Pure-executor contract (spec §5): POST /v1/run (JSON) and
 * POST /v1/run/stream (SSE). The caller supplies everything — code, tests,
 * signature — and the service keeps no state about questions.
 */

export interface RunTestSpec {
  /** Positional arguments for the function. */
  input: unknown[];
  expected: unknown;
  /** Echoed back on the result so the caller can redact; never used to judge. */
  hidden?: boolean;
}

export interface RunLimits {
  /** CPU-time limit for the whole run (all tests, one process). ≤ 10 000. */
  timeMs?: number;
  /** Memory limit for the process. ≤ 512. */
  memoryMb?: number;
}

export interface RunRequest {
  language: Language;
  code: string;
  /** Dependency sources placed before `code` (same language; not Java). */
  prelude?: string[];
  functionName: string;
  /** Required for cpp, java and go. */
  signature?: ProblemSignature;
  compareMode?: CompareMode;
  tests: RunTestSpec[];
  limits?: RunLimits;
}

export type RunStatus = 'OK' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX';

export interface RunTestResult {
  idx: number;
  hidden: boolean;
  passed: boolean;
  /** CPU time of the call, µs (0 when the test didn't complete). */
  runUs: number;
  /** Wall time of the call, µs — a diagnostic. */
  wallUs: number;
  memoryKb: number;
  /** The function's return value (null when there is none). */
  actual: unknown;
  error?: string;
}

/** Payload of the SSE `verdict` event; the JSON response adds `tests`. */
export interface RunVerdict {
  status: RunStatus;
  totalPassed: number;
  totalTests: number;
  /** Sum of per-test runUs. */
  runUs: number;
  /** Max per-test memoryKb (C++: whole-process peak RSS). */
  memoryKb: number;
  /** Compiler (or TypeScript transpiler) time; compiled languages only. */
  compileMs?: number;
  error?: string;
}

export interface RunResponse extends RunVerdict {
  tests: RunTestResult[];
}
