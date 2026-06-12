import { Language } from '../../models/ExecutionResult.js';

/**
 * Outcome of running user code through the sandbox adapter.
 *
 * `runMs` reflects user-CPU time of the run phase only (not compile, not
 * adapter setup); `wallMs` is the wall-clock of the run phase; both are
 * extracted from the isolate meta file with ~1 ms precision.
 */
export type SandboxStatus = 'OK' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'XX';

export interface SandboxResult {
  output: string;
  error?: string;
  status: SandboxStatus;
  runMs: number;
  wallMs: number;
  memoryKb: number;
  compileMs?: number;
  exitCode?: number;
}

export interface RunOptions {
  timeoutMs?: number;
  memoryKb?: number;
  pidsLimit?: number;
}

/**
 * Per-language compile/run recipe. The adapter calls these to materialise
 * sources, pick argv for compile and run phases, and (for Java) detect the
 * entry class name from user code.
 */
export interface LanguageSpec {
  language: Language;
  /** File written into the sandbox box (e.g. "main.py" or "Main.java"). */
  mainFileName(code: string): string;
  /** True when we need a compile phase before run. */
  needsCompile: boolean;
  /** Argv for the compile phase, given the source file name. Undefined for interpreted langs. */
  compileArgv?(mainFile: string): string[];
  /** Argv for the run phase. For compiled langs, the compile artifact is implied to be present. */
  runArgv(mainFile: string): string[];
  /**
   * Files produced by the compile phase that must be copied into the run box
   * (and into the compile cache). e.g. cpp → ['a.out'], java → ['Main.class'].
   * Undefined for interpreted languages.
   */
  artifacts?(mainFile: string): string[];
  /**
   * Maximum number of tasks (processes + threads) the user submission is
   * allowed to create at runtime. Competitive-programming convention is to
   * forbid user-spawned threads; this cap is set just high enough for the
   * language runtime itself (e.g. JVM internals) but too low for a user to
   * parallelise the algorithm on top.
   *
   * The actual fairness mechanism is single-core CPU pinning (see
   * isolateAdapter); this cap is the fork-bomb defence.
   */
  pidsLimit: number;
}

export interface SandboxAdapter {
  name: 'isolate';
  execute(
    language: Language,
    code: string,
    input: string,
    options?: RunOptions
  ): Promise<SandboxResult>;
}
