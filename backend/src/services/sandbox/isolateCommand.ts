import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { boxCpuList, CpuPlan } from './cpuPinning.js';
import { LanguageSpec, RunOptions } from './types.js';

/**
 * Everything the isolate adapter passes to `isolate --run`, built by pure
 * functions so the exact command line is unit-tested per language and phase
 * (tests/sandbox/isolateCommand.test.ts). The adapter only adds file I/O.
 */

/**
 * isolate syscall_flags ("System call restrictions" in man isolate; per run
 * with --syscalls since isolate 2.7). Each set bit is one restriction —
 * keyrings (1), AF_VSOCK sockets (2), file locks (4), io_uring (8),
 * non-native architectures (16) — and 0xffff also covers restrictions a
 * future isolate adds. Every box runs with all of them...
 */
export const SYSCALLS_STRICT = 0xffff;
/**
 * ...except that a compile box whose compiler needs file locks
 * (LanguageSpec.compileNeedsFileLocks: `go build`) drops flag 4. Locks on an
 * inode shared between boxes (anything under the read-only /usr) are a side
 * channel between boxes running at the same moment; a compile box runs the
 * compiler, not learner code, so the channel has no sender there.
 */
export const SYSCALL_FILE_LOCKS = 4;

/**
 * The environment every box starts from; isolate adds only its own
 * LIBC_FATAL_STDERR_=1. The service's environment (INTERNAL_TOKEN, …) never
 * enters a box. Language specs layer their variables on top.
 *   PATH  /usr first: GCC finds its headers and cc1plus relative to the path
 *         it was started from (as /bin/g++ it looks under /include), and
 *         collect2 searches PATH for ld.
 *   HOME  the box's working directory: writable, private, removed with it.
 *   LANG  UTF-8 standard streams (Java's System.out is US-ASCII without a
 *         UTF-8 locale; Python's stdio follows it too).
 */
export const BOX_BASE_ENV: Readonly<Record<string, string>> = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: '/box',
  LANG: 'C.UTF-8',
});

export function boxEnv(extra?: Record<string, string>): Record<string, string> {
  return { ...BOX_BASE_ENV, ...extra };
}

export type BoxPhase = 'compile' | 'run';

/** One `isolate --run`: the program, its limits, environment and CPUs. */
export interface BoxSpec {
  phase: BoxPhase;
  argv: string[];
  /** CPU-time limit (--time). */
  timeoutMs: number;
  /** Wall-clock limit (--wall-time): catches sleeping programs. */
  wallTimeoutMs: number;
  /** cgroup memory cap (--cg-mem, KB). */
  memoryKb: number;
  /** Processes + threads (--processes: RLIMIT_NPROC). */
  pidsLimit: number;
  /** Largest file the program may write, stdout and stderr included (--fsize, KB). */
  fsizeKb: number;
  /** --syscalls (see SYSCALLS_STRICT). */
  syscallFlags: number;
  env: Record<string, string>;
  /** Extra directory rules (--dir). */
  dirs: string[];
  stdinFile?: string;
  /** `taskset -c` CPU list; undefined when pinning is off. */
  cpus?: string;
}

/** The run limits for one execution: RunOptions win, then the language, then the defaults. */
export function resolveRunLimits(
  spec: LanguageSpec,
  options?: Pick<RunOptions, 'timeoutMs' | 'memoryKb' | 'pidsLimit'>
): { timeoutMs: number; memoryKb: number; pidsLimit: number } {
  const limits = SANDBOX_CONFIG.limits;
  return {
    timeoutMs: options?.timeoutMs ?? limits.timeoutMs,
    memoryKb: options?.memoryKb ?? limits.memoryKb,
    // Per-language cap first, so each runtime gets exactly what it needs to
    // boot and no more; RunOptions still wins if a caller overrides it.
    pidsLimit: options?.pidsLimit ?? spec.pidsLimit ?? limits.pidsLimit,
  };
}

export function compileBoxSpec(
  spec: LanguageSpec,
  mainFile: string,
  plan: CpuPlan | null,
  boxId: number
): BoxSpec {
  const limits = SANDBOX_CONFIG.compileLimits;
  if (!spec.compileArgv) throw new Error(`${spec.language} has no compile phase`);
  return {
    phase: 'compile',
    argv: spec.compileArgv(mainFile),
    timeoutMs: limits.timeoutMs,
    wallTimeoutMs: limits.timeoutMs * 2,
    // --cg-mem caps the control group's real memory use (and is what makes
    // cg-oom-killed → MLE work). Plain --mem would be RLIMIT_AS — an
    // address-space cap that Go (~600 MB of reservations at startup), the
    // JVM and V8 cannot even start under.
    memoryKb: limits.memoryKb,
    pidsLimit: spec.compilePidsLimit ?? limits.pidsLimit,
    fsizeKb: limits.fsizeKb,
    syscallFlags: spec.compileNeedsFileLocks
      ? SYSCALLS_STRICT & ~SYSCALL_FILE_LOCKS
      : SYSCALLS_STRICT,
    env: boxEnv(spec.compileEnv?.('isolate')),
    dirs: spec.compileDirs?.() ?? [],
    cpus: plan ? boxCpuList(plan, 'compile', boxId) : undefined,
  };
}

export function runBoxSpec(
  spec: LanguageSpec,
  mainFile: string,
  limits: { timeoutMs: number; memoryKb: number; pidsLimit: number },
  plan: CpuPlan | null,
  boxId: number
): BoxSpec {
  return {
    phase: 'run',
    argv: spec.runArgv(mainFile),
    timeoutMs: limits.timeoutMs,
    wallTimeoutMs: limits.timeoutMs * 2,
    memoryKb: limits.memoryKb,
    pidsLimit: limits.pidsLimit,
    fsizeKb: SANDBOX_CONFIG.limits.outputKb,
    syscallFlags: SYSCALLS_STRICT,
    env: boxEnv(spec.runEnv?.('isolate', { memoryKb: limits.memoryKb })),
    dirs: [],
    stdinFile: 'stdin.txt',
    cpus: plan ? boxCpuList(plan, 'run', boxId) : undefined,
  };
}

/** Where isolate writes the meta file (outside the box) and the program's streams (inside it). */
export interface BoxFiles {
  metaPath: string;
  stdoutFile: string;
  stderrFile: string;
}

function seconds(ms: number): string {
  return (ms / 1000).toFixed(3);
}

/** Arguments of `isolate --run` for one box. */
export function isolateRunArgs(boxId: number, box: BoxSpec, files: BoxFiles): string[] {
  const args = [
    '--cg',
    `--box-id=${boxId}`,
    `--time=${seconds(box.timeoutMs)}`,
    `--wall-time=${seconds(box.wallTimeoutMs)}`,
    `--cg-mem=${box.memoryKb}`,
    `--processes=${box.pidsLimit}`,
    `--fsize=${box.fsizeKb}`,
    // RLIMIT_CORE: no core files (isolate's default too — stated, not
    // assumed; a crash must not write the box's memory to disk).
    '--core=0',
    `--syscalls=${box.syscallFlags}`,
    `--meta=${files.metaPath}`,
    `--stdout=${files.stdoutFile}`,
    `--stderr=${files.stderrFile}`,
    '--silent',
  ];
  if (box.stdinFile) args.push(`--stdin=${box.stdinFile}`);
  for (const [name, value] of Object.entries(box.env)) args.push(`--env=${name}=${value}`);
  for (const rule of box.dirs) args.push(`--dir=${rule}`);
  args.push('--run', '--', ...box.argv);
  return args;
}

export interface Command {
  file: string;
  args: string[];
}

/**
 * The process to spawn for one box: isolate itself, or isolate under
 * `taskset -c <cpus>` when the box is pinned. The CPU mask is inherited by
 * isolate's keeper and proxy and by the program in the box.
 */
export function isolateCommand(
  box: BoxSpec,
  boxId: number,
  files: BoxFiles,
  binaries: { isolate: string; taskset: string } = {
    isolate: SANDBOX_CONFIG.isolate.binary,
    taskset: 'taskset',
  }
): Command {
  const args = isolateRunArgs(boxId, box, files);
  return box.cpus === undefined
    ? { file: binaries.isolate, args }
    : { file: binaries.taskset, args: ['-c', box.cpus, binaries.isolate, ...args] };
}
