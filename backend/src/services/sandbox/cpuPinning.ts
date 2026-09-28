import { readFileSync } from 'node:fs';

/**
 * CPU pinning policy for isolate boxes (decision 03): every run box gets
 * exactly one CPU, so a learner can neither buy a better wall time by running
 * threads in parallel nor take CPU from other learners' boxes.
 *
 * This module is the only place the policy lives. The isolate adapter applies
 * it to every box it starts, and the container entrypoint turns the same plan
 * into isolate per-box cpusets (cpuPinningCli.ts). It is pure apart from
 * readAllowedCpus, so it is unit-tested directly.
 *
 *   · The CPUs the service may use are its own affinity at startup
 *     (Cpus_allowed_list): whatever the container or systemd unit grants.
 *   · With RESERVE_API_CPU_MIN or more CPUs, the first one is kept free of
 *     boxes for the API process (request handling, spawning isolate,
 *     TypeScript transpiles) and the kernel's housekeeping on CPU 0. With
 *     fewer, the boxes need every CPU.
 *   · Run box N is pinned to boxCpus[N mod boxCpus.length]. The run-box pool
 *     hands out ids from the top down, so k concurrent boxes land on k
 *     different CPUs while k <= boxCpus.length.
 *   · Compile boxes run trusted compilers, not learner code, and javac and
 *     `go build` are multi-threaded: they may use every box CPU (but not
 *     the API's).
 *
 * Enforcement has two layers, because an affinity mask alone is advisory: a
 * program can widen its own mask with sched_setaffinity(2). (Measured under
 * isolate with taskset only: one RawSyscall let a Go program spread over all
 * 10 CPUs of the host.)
 *   1. The adapter starts every isolate run under `taskset -c <cpus>`; the
 *      box inherits the mask. This works on any host.
 *   2. Where the entrypoint can configure isolate (the Docker image), the
 *      same plan becomes each box's cgroup cpuset (`box<N>.cpus`). A cpuset
 *      is a hard limit — sched_setaffinity can only choose within it.
 * The readiness probe reports which of the two is in force.
 */

export type CpuPinningMode = 'round-robin' | 'off';

/** ISOLATE_CPU_PINNING: unset or "round-robin" (default), or "off". */
export function parsePinningMode(value: string | undefined): CpuPinningMode {
  const v = (value ?? '').trim().toLowerCase();
  if (v === '' || v === 'round-robin') return 'round-robin';
  if (v === 'off') return 'off';
  throw new Error(`ISOLATE_CPU_PINNING must be "round-robin" or "off", got ${JSON.stringify(value)}`);
}

/** Kernel cpu-list syntax ("0-3,6,8-9") → sorted, de-duplicated CPU numbers. */
export function parseCpuList(list: string): number[] {
  const cpus = new Set<number>();
  for (const part of list.trim().split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`invalid CPU list ${JSON.stringify(list)}`);
    const lo = Number(m[1]);
    const hi = m[2] === undefined ? lo : Number(m[2]);
    if (hi < lo) throw new Error(`invalid CPU range ${JSON.stringify(part)}`);
    for (let c = lo; c <= hi; c++) cpus.add(c);
  }
  return [...cpus].sort((a, b) => a - b);
}

/** [0,1,2,3,6] → "0-3,6" (taskset / cpuset syntax). */
export function formatCpuList(cpus: readonly number[]): string {
  const sorted = [...new Set(cpus)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(',');
}

/**
 * The CPUs this process may run on, from the Cpus_allowed_list line of
 * /proc/self/status (Linux). null where that is unavailable (macOS dev).
 */
export function readAllowedCpus(statusText?: string): number[] | null {
  let text = statusText;
  if (text === undefined) {
    try {
      text = readFileSync('/proc/self/status', 'utf8');
    } catch {
      return null;
    }
  }
  const m = /^Cpus_allowed_list:[ \t]*(\S+)[ \t]*$/m.exec(text);
  if (!m) return null;
  const cpus = parseCpuList(m[1]);
  return cpus.length > 0 ? cpus : null;
}

/** From this many CPUs up, one is reserved for the API process. */
export const RESERVE_API_CPU_MIN = 4;

export interface CpuPlan {
  /** Every CPU available to the service. */
  cpus: number[];
  /** Kept free of boxes for the API, when there are enough CPUs. */
  apiCpu?: number;
  /** The CPUs boxes run on: `cpus` without `apiCpu`. */
  boxCpus: number[];
}

export function planCpus(available: readonly number[]): CpuPlan {
  const cpus = [...new Set(available)].sort((a, b) => a - b);
  if (cpus.length === 0) throw new Error('planCpus: no CPUs');
  if (cpus.length < RESERVE_API_CPU_MIN) return { cpus, boxCpus: cpus };
  const [apiCpu, ...boxCpus] = cpus;
  return { cpus, apiCpu, boxCpus };
}

/** The single CPU run box `boxId` is pinned to. */
export function runBoxCpu(plan: CpuPlan, boxId: number): number {
  if (!Number.isInteger(boxId) || boxId < 0) throw new Error(`invalid box id ${boxId}`);
  return plan.boxCpus[boxId % plan.boxCpus.length];
}

/** CPU list (taskset -c / cpuset syntax) for a box of the given phase. */
export function boxCpuList(plan: CpuPlan, phase: 'compile' | 'run', boxId: number): string {
  return phase === 'run' ? String(runBoxCpu(plan, boxId)) : formatCpuList(plan.boxCpus);
}

/** One line for the startup log. */
export function describePlan(plan: CpuPlan): string {
  const boxes = `run boxes on CPUs ${formatCpuList(plan.boxCpus)}, one CPU each`;
  return plan.apiCpu === undefined
    ? `${boxes} (no CPU reserved for the API: fewer than ${RESERVE_API_CPU_MIN} CPUs)`
    : `${boxes}, CPU ${plan.apiCpu} reserved for the API`;
}

/**
 * isolate config lines that make the plan binding: a cgroup cpuset per box.
 * Run boxes get their one CPU, compile boxes every box CPU.
 */
export function isolateCpusetLines(
  plan: CpuPlan,
  runBoxIds: Iterable<number>,
  compileBoxIds: Iterable<number>
): string[] {
  const lines: string[] = [];
  for (const id of runBoxIds) lines.push(`box${id}.cpus = ${boxCpuList(plan, 'run', id)}`);
  for (const id of compileBoxIds) lines.push(`box${id}.cpus = ${boxCpuList(plan, 'compile', id)}`);
  return lines;
}

/** Box ids the isolate adapter's two pools hand out (see isolateAdapter). */
export function boxIdRanges(maxBoxes: number, compileBoxes: number): {
  run: number[];
  compile: number[];
} {
  return {
    run: Array.from({ length: maxBoxes }, (_, i) => i),
    compile: Array.from({ length: compileBoxes }, (_, i) => maxBoxes + i),
  };
}
