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

/**
 * Progress phases an adapter reports while it works, at the moment they
 * actually happen:
 *   queued    — about to wait for a free sandbox box (isolate box pool);
 *   compiling — a real compile starts (or we wait on an identical in-flight
 *               one); never reported for a compile-cache hit;
 *   running   — the user program is about to start.
 */
export type RunPhase = 'queued' | 'compiling' | 'running';

export interface RunOptions {
  timeoutMs?: number;
  memoryKb?: number;
  pidsLimit?: number;
  onPhase?: (phase: RunPhase) => void;
  /**
   * Raw stdout chunks as the program produces them. Only adapters that can
   * observe output live call this (local); isolate writes stdout to a file
   * that is read once the run ends, so there it is never called and callers
   * fall back to the final `output`.
   */
  onStdout?: (chunk: string) => void;
  /**
   * Cancels the run. Checked between phases by every adapter; the local
   * adapter also kills a running process. An isolate run that has already
   * started is left to finish — it is bounded by its own time limit.
   */
  signal?: AbortSignal;
}

/** Where a compile runs: env values and paths differ between the two. */
export type SandboxBackendName = 'isolate' | 'local';

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
   * (and into the compile cache). e.g. cpp → ['a.out'], java → ['*.class'].
   * Entries may contain `*` globs; adapters expand them against the compile
   * output dir via resolveArtifactNames (Java can emit several .class files
   * from one source). Undefined for interpreted languages.
   */
  artifacts?(mainFile: string): string[];
  /**
   * Maximum number of tasks (processes + threads) the user submission is
   * allowed to create at runtime. Competitive-programming convention is to
   * forbid user-spawned threads; this cap is set just high enough for the
   * language runtime itself (e.g. JVM internals) but too low for a user to
   * parallelise the algorithm on top.
   *
   * The pid caps are the fork-bomb defence (isolate --processes, which is
   * RLIMIT_NPROC).
   */
  pidsLimit: number;
  /**
   * Task cap for the compile phase when the toolchain needs more than
   * SANDBOX_CONFIG.compileLimits.pidsLimit (javac / go build are
   * multi-threaded, and go build also spawns compile + link processes).
   */
  compilePidsLimit?: number;
  /**
   * Extra environment for the compile phase. isolate passes it with -E (the
   * box environment is otherwise empty); the local adapter layers it over
   * process.env.
   */
  compileEnv?(backend: SandboxBackendName): Record<string, string>;
  /** Extra isolate directory rules (`--dir=` values) for the compile box. */
  compileDirs?(): string[];
  /** Extra environment for the run phase (same layering as compileEnv). */
  runEnv?(backend: SandboxBackendName, options: { memoryKb: number }): Record<string, string>;
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
