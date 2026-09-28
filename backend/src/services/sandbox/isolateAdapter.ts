import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxLanguage } from '../../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { BoxPool } from './boxPool.js';
import { BoxFileRead, readBoxFile, readBoxFileHeadTail, runBoxResult } from './boxOutput.js';
import { compileCache, type FreshCompileOutcome } from './compileCache.js';
import { CpuPlan, describePlan, planCpus, readAllowedCpus } from './cpuPinning.js';
import {
  BoxSpec,
  Command,
  compileBoxSpec,
  isolateCommand,
  resolveRunLimits,
  runBoxSpec,
} from './isolateCommand.js';
import { getLanguageSpec, resolveArtifactNames } from './languageSpec.js';
import { IsolateMeta, mapMetaToStatus, parseIsolateMeta } from './metaParser.js';
import { LanguageSpec, RunOptions, SandboxAdapter, SandboxResult } from './types.js';

/**
 * Production adapter on Linux. Drives the `isolate` binary
 * (https://github.com/ioi/isolate, >= 2.7) with cgroups v2 + namespaces.
 * Each request gets one (or two, for compiled languages) fresh boxes and
 * reads the meta file isolate writes to extract microsecond-precision timing
 * and peak memory.
 *
 * Two-phase flow for C++ / Java / Go:
 *   1. compile box: looser limits, separate meta -> compileMs.
 *      On non-zero exit, fail fast as 'CE'.
 *   2. run box: user-specified limits, separate meta -> runMs / memoryKb.
 *
 * The compile cost is therefore *not* charged against the user's run-time
 * budget, which is the core fix for the "timing dominated by setup" bug.
 *
 * Every box gets an explicit command line (isolateCommand.ts): a minimal
 * environment, the strictest syscall filter (only Go's compile box may take
 * file locks), no core dumps, a file-size cap, and — unless
 * ISOLATE_CPU_PINNING=off — a CPU mask from cpuPinning.ts.
 *
 * Box pools: a request holds its run box while it compiles, so compile boxes
 * come from a separate pool. With one shared pool, N concurrent compiled-
 * language requests (N = pool size) could each hold a run box and wait
 * forever for a compile box — a hold-and-wait deadlock the inline SSE path
 * would hit under a burst.
 */

const pool = new BoxPool(SANDBOX_CONFIG.isolate.maxBoxes);
const compilePool = new BoxPool(SANDBOX_CONFIG.isolate.compileBoxes, SANDBOX_CONFIG.isolate.maxBoxes);
const META_DIR = '/tmp';

// ── CPU pinning ─────────────────────────────────────────────────────────────

interface Pinning {
  /** null: pinning is off. */
  plan: CpuPlan | null;
  taskset: string;
}

let pinning: Pinning | undefined;

function findExecutable(name: string): string | null {
  for (const dir of (process.env.PATH ?? '/usr/bin:/bin').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try {
      accessSync(file, fsConstants.X_OK);
      return file;
    } catch {
      // not here
    }
  }
  return null;
}

/**
 * The CPU plan every box is started with, resolved on first use. Throws when
 * pinning is on but cannot be applied; the startup readiness probe calls it
 * first, so a misconfigured host fails at boot instead of running boxes
 * unpinned.
 */
export function cpuPinning(): Pinning {
  if (pinning) return pinning;
  if (SANDBOX_CONFIG.isolate.cpuPinning === 'off') {
    pinning = { plan: null, taskset: 'taskset' };
    return pinning;
  }
  const cpus = readAllowedCpus();
  if (!cpus) {
    throw new Error(
      'ISOLATE_CPU_PINNING=round-robin, but the CPUs available to this process are unknown ' +
        '(no Cpus_allowed_list in /proc/self/status). Set ISOLATE_CPU_PINNING=off to run boxes unpinned.'
    );
  }
  const taskset = findExecutable('taskset');
  if (!taskset) {
    throw new Error(
      'ISOLATE_CPU_PINNING=round-robin needs taskset (util-linux) on PATH. ' +
        'Install it, or set ISOLATE_CPU_PINNING=off to run boxes unpinned.'
    );
  }
  pinning = { plan: planCpus(cpus), taskset };
  return pinning;
}

// ── isolate plumbing ────────────────────────────────────────────────────────

function runIsolate(command: Command): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    // isolate's own output (the box path, fatal errors) — never the program's.
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
  });
}

async function initBox(boxId: number): Promise<string> {
  const result = await runIsolate({
    file: SANDBOX_CONFIG.isolate.binary,
    args: ['--cg', `--box-id=${boxId}`, '--init'],
  });
  if (result.exitCode !== 0) {
    throw new Error(`isolate --init failed for box ${boxId}: ${result.stderr.trim()}`);
  }
  return path.join(result.stdout.trim(), 'box');
}

async function cleanupBox(boxId: number): Promise<void> {
  await runIsolate({
    file: SANDBOX_CONFIG.isolate.binary,
    args: ['--cg', `--box-id=${boxId}`, '--cleanup'],
  }).catch(() => undefined);
}

interface BoxRun {
  meta: IsolateMeta;
  /**
   * Set when isolate itself failed (exit >= 2, or no meta file — e.g. taskset
   * or an unknown option), as opposed to the program failing (exit 1).
   */
  sandboxError?: string;
  stdout: BoxFileRead;
  stderr: BoxFileRead;
}

async function runInBox(boxId: number, boxDir: string, box: BoxSpec): Promise<BoxRun> {
  const files = {
    metaPath: path.join(META_DIR, `isolate-${boxId}-${Date.now()}.meta`),
    stdoutFile: `stdout-${boxId}.txt`,
    stderrFile: `stderr-${boxId}.txt`,
  };
  const result = await runIsolate(
    isolateCommand(box, boxId, files, {
      isolate: SANDBOX_CONFIG.isolate.binary,
      taskset: cpuPinning().taskset,
    })
  );

  const tailBudget = SANDBOX_CONFIG.isolate.stderrReadBytes;
  const [metaText, stdout, stderr] = await Promise.all([
    readFile(files.metaPath, 'utf8').catch(() => ''),
    box.phase === 'run'
      ? readBoxFile(path.join(boxDir, files.stdoutFile), SANDBOX_CONFIG.limits.outputKb * 1024)
      : readBoxFileHeadTail(path.join(boxDir, files.stdoutFile), tailBudget),
    readBoxFileHeadTail(path.join(boxDir, files.stderrFile), tailBudget),
  ]);
  await rm(files.metaPath, { force: true }).catch(() => undefined);

  const sandboxError =
    result.exitCode >= 2 || result.exitCode < 0 || metaText.trim() === ''
      ? `isolate failed (exit ${result.exitCode}): ${result.stderr.trim() || 'no meta file written'}`
      : undefined;
  return { meta: parseIsolateMeta(metaText), sandboxError, stdout, stderr };
}

/**
 * Compile in a fresh box and, on success, copy the artifacts out to a
 * standalone temp dir that outlives the box. This is the compile-cache thunk:
 * it owns the compile box's whole lifecycle (acquire → init → compile →
 * cleanup → release) and hands back a dir the cache adopts. The cache removes
 * that dir on eviction. A sandbox failure throws (never a cached CE).
 */
async function compileToArtifactDir(
  spec: LanguageSpec,
  mainFile: string,
  code: string,
  artifactNames: string[]
): Promise<FreshCompileOutcome> {
  const boxId = await compilePool.acquire();
  try {
    const boxDir = await initBox(boxId);
    await writeFile(path.join(boxDir, mainFile), code);

    const run = await runInBox(boxId, boxDir, compileBoxSpec(spec, mainFile, cpuPinning().plan, boxId));
    if (run.sandboxError) throw new Error(run.sandboxError);
    const { meta } = run;
    const compileMs = (meta.timeWall ?? meta.time ?? 0) * 1000;

    if (mapMetaToStatus(meta) !== 'OK') {
      return {
        kind: 'fail',
        result: {
          output: '',
          // Compilers report on stderr; stdout is only a fallback.
          error: run.stderr.text.trim() || run.stdout.text.trim() || meta.message || 'Compilation failed',
          status: 'CE',
          runMs: 0,
          wallMs: compileMs,
          memoryKb: meta.cgMem ?? meta.maxRss ?? 0,
          compileMs,
          exitCode: meta.exitcode,
        },
      };
    }

    // Artifact patterns may contain globs (java: '*.class') — resolve them to
    // concrete file names against the compile box before copying out.
    const resolvedNames = await resolveArtifactNames(boxDir, artifactNames);
    const artifactDir = await mkdtemp(path.join(os.tmpdir(), 'codemare-art-'));
    await Promise.all(
      resolvedNames.map((name) =>
        cp(path.join(boxDir, name), path.join(artifactDir, name))
      )
    );
    return { kind: 'ok', dir: artifactDir, artifacts: resolvedNames, compileMs };
  } finally {
    await cleanupBox(boxId);
    compilePool.release(boxId);
  }
}

function cancelled(compileMs?: number): SandboxResult {
  return { output: '', error: 'Run cancelled', status: 'XX', runMs: 0, wallMs: 0, memoryKb: 0, compileMs };
}

async function execute(
  language: SandboxLanguage,
  code: string,
  input: string,
  options?: RunOptions
): Promise<SandboxResult> {
  const spec = getLanguageSpec(language);
  const limits = resolveRunLimits(spec, options);
  const mainFile = spec.mainFileName(code);
  const signal = options?.signal;
  if (signal?.aborted) return cancelled();

  const runBoxId = await pool.acquire(() => options?.onPhase?.('queued'));
  let compileMs: number | undefined;

  try {
    // Disconnected while queued: give the box straight back.
    if (signal?.aborted) return cancelled();
    const runBoxDir = await initBox(runBoxId);

    if (spec.needsCompile) {
      const artifactNames = spec.artifacts!(mainFile);
      const thunk = (): Promise<FreshCompileOutcome> =>
        compileToArtifactDir(spec, mainFile, code, artifactNames);

      // Compile through the cache: a re-run of unchanged code skips the
      // compile box entirely. When caching is disabled, run the thunk once and
      // clean up the throwaway artifact dir ourselves.
      let artifactDir: string;
      let resolvedArtifacts: string[];
      let ownDir = false;
      if (SANDBOX_CONFIG.compileCache.enabled) {
        const key = compileCache.key(language, spec.compileArgv!(mainFile), code);
        // Only a real (or in-flight) compile is a "compiling" phase.
        if (!compileCache.has(key)) options?.onPhase?.('compiling');
        const outcome = await compileCache.getOrCompile(key, thunk);
        if (outcome.kind === 'fail') return outcome.result;
        compileMs = outcome.compileMs;
        artifactDir = outcome.dir;
        resolvedArtifacts = outcome.artifacts;
      } else {
        options?.onPhase?.('compiling');
        const fresh = await thunk();
        if (fresh.kind === 'fail') return fresh.result;
        compileMs = fresh.compileMs;
        artifactDir = fresh.dir;
        resolvedArtifacts = fresh.artifacts;
        ownDir = true;
      }

      try {
        await Promise.all(
          resolvedArtifacts.map((name) =>
            cp(path.join(artifactDir, name), path.join(runBoxDir, name))
          )
        );
      } finally {
        if (ownDir) await rm(artifactDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } else {
      await writeFile(path.join(runBoxDir, mainFile), code);
    }

    await writeFile(path.join(runBoxDir, 'stdin.txt'), input);

    // A started isolate run is not killed on cancel: it is bounded by its own
    // limits, and cleanupBox below tears the box down either way.
    if (signal?.aborted) return cancelled(compileMs);
    options?.onPhase?.('running');
    const run = await runInBox(
      runBoxId,
      runBoxDir,
      runBoxSpec(spec, mainFile, limits, cpuPinning().plan, runBoxId)
    );
    if (run.sandboxError) {
      return { output: '', error: run.sandboxError, status: 'XX', runMs: 0, wallMs: 0, memoryKb: 0, compileMs };
    }
    return runBoxResult({
      meta: run.meta,
      stdout: run.stdout,
      stderr: run.stderr,
      timeoutMs: limits.timeoutMs,
      memoryKb: limits.memoryKb,
      outputCapBytes: SANDBOX_CONFIG.limits.outputKb * 1024,
      compileMs,
    });
  } finally {
    await cleanupBox(runBoxId);
    pool.release(runBoxId);
  }
}

export const isolateAdapter: SandboxAdapter = {
  name: 'isolate',
  execute,
};

// ── startup check: is the pinning binding? ──────────────────────────────────

/**
 * Runs in an ordinary run box: reads the box's CPU mask, then tries to widen
 * it to every CPU, as a program that wanted to run threads in parallel would.
 */
const PINNING_PROBE = [
  'import json, os',
  'before = sorted(os.sched_getaffinity(0))',
  'try:',
  '    os.sched_setaffinity(0, range(1024))',
  'except OSError:',
  '    pass',
  'print(json.dumps([before, sorted(os.sched_getaffinity(0))]))',
].join('\n');

export interface PinningCheck {
  /**
   *   off         ISOLATE_CPU_PINNING=off
   *   enforced    one CPU, and widening it had no effect (cgroup cpuset)
   *   advisory    one CPU, but the program could widen its mask (taskset only)
   *   not-applied the box saw several CPUs
   *   unverified  the probe could not run
   */
  state: 'off' | 'enforced' | 'advisory' | 'not-applied' | 'unverified';
  message: string;
}

export async function checkCpuPinning(): Promise<PinningCheck> {
  const { plan } = cpuPinning();
  if (!plan) return { state: 'off', message: 'off (ISOLATE_CPU_PINNING=off): boxes may use every CPU' };
  const summary = describePlan(plan);
  const res = await execute('python', PINNING_PROBE, '');
  let before: number[];
  let after: number[];
  try {
    if (res.status !== 'OK') throw new Error(res.error ?? res.status);
    [before, after] = JSON.parse(res.output.trim()) as [number[], number[]];
  } catch (err) {
    return {
      state: 'unverified',
      message: `${summary}; could not verify it (${err instanceof Error ? err.message : String(err)})`,
    };
  }
  if (before.length !== 1) {
    return {
      state: 'not-applied',
      message: `${summary}, but a run box saw CPUs ${before.join(',')}: pinning is NOT applied`,
    };
  }
  if (after.length > before.length) {
    return {
      state: 'advisory',
      message:
        `${summary}; ADVISORY ONLY: boxes start pinned (taskset), but a program widened its own ` +
        `mask to ${after.length} CPUs with sched_setaffinity. Give each box a cpuset in the isolate ` +
        'config (box<N>.cpus; the container entrypoint writes them) to make it binding.',
    };
  }
  return {
    state: 'enforced',
    message: `${summary}; enforced by per-box cpusets (sched_setaffinity cannot widen a box)`,
  };
}
