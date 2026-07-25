export type Language = 'python' | 'javascript' | 'cpp' | 'java';

export interface ExecutionRequest {
  problemId: string;
  language: Language;
  code: string;
}

/**
 * `executionTime` and `memoryUsed` are kept for backwards compatibility with the
 * pre-sandbox response shape; new code should populate and consume `runMs` and
 * `memoryKb` (the accurate per-run user-CPU and peak RSS numbers reported by
 * the sandbox adapter).
 */
export interface TestCaseResult {
  input: any[];
  expectedOutput: any;
  actualOutput: any;
  passed: boolean;
  executionTime: number; // legacy: wall-clock ms
  runMs?: number;
  wallMs?: number;
  memoryKb?: number;
  error?: string;
  hidden?: boolean;
}

export type SandboxResultStatus = 'OK' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX';

/**
 * Judge-level verdict: the sandbox statuses plus 'WA' (Wrong Answer), which
 * the sandbox itself never emits — it only knows the process exited cleanly.
 * 'WA' is derived in the execution services when a clean run fails tests.
 */
export type ExecutionStatus = SandboxResultStatus | 'WA';

export interface ExecutionResponse {
  success: boolean;
  testResults: TestCaseResult[];
  totalPassed: number;
  totalTests: number;
  executionTime: number; // legacy: server-side total round-trip ms
  memoryUsed: number; // legacy: in bytes; 0 when not measured
  runMs?: number;
  wallMs?: number;
  memoryKb?: number;
  compileMs?: number;
  status?: ExecutionStatus;
  error?: string;
}

export interface DockerExecutionInput {
  code: string;
  tests: {
    input: any[];
    expected: any;
  }[];
  functionName: string;
}

export interface DockerExecutionOutput {
  results?: {
    output: any;
    expected: any;
    passed: boolean;
    error?: string;
  }[];
  error?: string;
  traceback?: string;
}
