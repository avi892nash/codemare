import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Language } from '../../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { BoxPool } from './boxPool.js';
import { compileCache, type FreshCompileOutcome } from './compileCache.js';
import { getLanguageSpec, resolveArtifactNames } from './languageSpec.js';
import { mapMetaToStatus, parseIsolateMeta } from './metaParser.js';
import { LanguageSpec, RunOptions, SandboxAdapter, SandboxResult } from './types.js';

/**
 * Production adapter on Linux. Drives the `isolate` binary
 * (https://github.com/ioi/isolate) with cgroups v2 + namespaces. Each request
 * gets one (or two, for compiled languages) fresh boxes and reads the meta
 * file isolate writes to extract microsecond-precision timing and peak
 * memory.
 *
 * Two-phase flow for C++ / Java:
 *   1. compile box: looser limits, separate meta -> compileMs.
 *      On non-zero exit, fail fast as 'CE'.
 *   2. run box: user-specified limits, separate meta -> runMs / memoryKb.
 *
 * The compile cost is therefore *not* charged against the user's run-time
 * budget, which is the core fix for the "timing dominated by setup" bug.
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

/**
 * Host cores, resolved once. NB: the value is passed as isolate `--core=N`,
 * which is RLIMIT_CORE (max core-dump size in KB) — isolate has no CPU
 * affinity option, so this does not pin the run to a core. Kept as-is
 * (harmless) pending a decision on real pinning (e.g. taskset in the box).
 */
const HOST_CORES = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);

interface IsolateRunSpec {
  argv: string[];
  timeoutMs: number;
  memoryKb: number;
  pidsLimit: number;
  /** See HOST_CORES: forwarded as `--core=N` (RLIMIT_CORE), not pinning. */
  cpuCore?: number;
  stdinFile?: string;
  /** Environment for the program (-E var=value); the box env is otherwise empty. */
  env?: Record<string, string>;
  /** Extra directory rules (`--dir=in=out[:opts]`). */
  dirs?: string[];
}

interface IsolateRunResult {
  metaText: string;
  stdout: string;
  stderr: string;
}

function runIsolate(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(SANDBOX_CONFIG.isolate.binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? -1 }));
  });
}

async function initBox(boxId: number): Promise<string> {
  const result = await runIsolate(['--cg', `--box-id=${boxId}`, '--init']);
  if (result.exitCode !== 0) {
    throw new Error(`isolate --init failed for box ${boxId}: ${result.stderr.trim()}`);
  }
  return path.join(result.stdout.trim(), 'box');
}

async function cleanupBox(boxId: number): Promise<void> {
  await runIsolate(['--cg', `--box-id=${boxId}`, '--cleanup']).catch(() => undefined);
}

async function runInBox(boxId: number, spec: IsolateRunSpec): Promise<IsolateRunResult> {
  const metaPath = path.join(META_DIR, `isolate-${boxId}-${Date.now()}.meta`);
  const stdoutFile = `stdout-${boxId}.txt`;
  const stderrFile = `stderr-${boxId}.txt`;

  const args = [
    '--cg',
    `--box-id=${boxId}`,
    `--time=${(spec.timeoutMs / 1000).toFixed(3)}`,
    `--wall-time=${((spec.timeoutMs * 2) / 1000).toFixed(3)}`,
    // --cg-mem caps the control group's real memory use (and is what makes
    // cg-oom-killed → MLE work). Plain --mem would be RLIMIT_AS — an
    // address-space cap that the JVM and V8 (and any runtime that reserves
    // large virtual regions up front) cannot even start under at 256 MB.
    `--cg-mem=${spec.memoryKb}`,
    `--processes=${spec.pidsLimit}`,
    `--meta=${metaPath}`,
    `--stdout=${stdoutFile}`,
    `--stderr=${stderrFile}`,
    '--silent',
  ];
  if (spec.cpuCore !== undefined) {
    args.push(`--core=${spec.cpuCore}`);
  }
  if (spec.stdinFile) {
    args.push(`--stdin=${spec.stdinFile}`);
  }
  for (const [name, value] of Object.entries(spec.env ?? {})) {
    args.push(`--env=${name}=${value}`);
  }
  for (const rule of spec.dirs ?? []) {
    args.push(`--dir=${rule}`);
  }
  args.push('--run', '--', ...spec.argv);

  await runIsolate(args);

  const boxDir = path.join('/var/local/lib/isolate', String(boxId), 'box');
  const [metaText, stdout, stderr] = await Promise.all([
    readFile(metaPath, 'utf8').catch(() => ''),
    readFile(path.join(boxDir, stdoutFile), 'utf8').catch(() => ''),
    readFile(path.join(boxDir, stderrFile), 'utf8').catch(() => ''),
  ]);
  await rm(metaPath, { force: true }).catch(() => undefined);

  return { metaText, stdout, stderr };
}

/**
 * Compile in a fresh box and, on success, copy the artifacts out to a
 * standalone temp dir that outlives the box. This is the compile-cache thunk:
 * it owns the compile box's whole lifecycle (acquire → init → compile →
 * cleanup → release) and hands back a dir the cache adopts. The cache removes
 * that dir on eviction.
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

    const result = await runInBox(boxId, {
      argv: spec.compileArgv!(mainFile),
      timeoutMs: SANDBOX_CONFIG.compileLimits.timeoutMs,
      memoryKb: SANDBOX_CONFIG.compileLimits.memoryKb,
      pidsLimit: spec.compilePidsLimit ?? SANDBOX_CONFIG.compileLimits.pidsLimit,
      env: spec.compileEnv?.('isolate'),
      dirs: spec.compileDirs?.(),
    });
    const meta = parseIsolateMeta(result.metaText);
    const compileMs = (meta.timeWall ?? meta.time ?? 0) * 1000;

    if (mapMetaToStatus(meta) !== 'OK') {
      return {
        kind: 'fail',
        result: {
          output: '',
          // Compilers report on stderr; stdout is only a fallback.
          error: result.stderr.trim() || result.stdout.trim() || meta.message || 'Compilation failed',
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
  language: Language,
  code: string,
  input: string,
  options?: RunOptions
): Promise<SandboxResult> {
  const spec = getLanguageSpec(language);
  const limits = SANDBOX_CONFIG.limits;
  const timeoutMs = options?.timeoutMs ?? limits.timeoutMs;
  const memoryKb = options?.memoryKb ?? limits.memoryKb;
  // Per-language cap takes precedence over the global default so each
  // runtime gets exactly what it needs to boot and no more. RunOptions still
  // wins if the caller explicitly overrides.
  const pidsLimit = options?.pidsLimit ?? spec.pidsLimit ?? limits.pidsLimit;
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
    const runResult = await runInBox(runBoxId, {
      argv: spec.runArgv(mainFile),
      timeoutMs,
      memoryKb,
      pidsLimit,
      cpuCore: runBoxId % HOST_CORES,
      stdinFile: 'stdin.txt',
      env: spec.runEnv?.('isolate', { memoryKb }),
    });

    const meta = parseIsolateMeta(runResult.metaText);
    const status = mapMetaToStatus(meta);
    const runMs = (meta.time ?? 0) * 1000;
    const wallMs = (meta.timeWall ?? meta.time ?? 0) * 1000;
    const memoryUsedKb = meta.cgMem ?? meta.maxRss ?? 0;

    return {
      output: runResult.stdout,
      error:
        status === 'OK'
          ? undefined
          : status === 'TLE'
            ? `Time limit exceeded (${timeoutMs} ms)`
            : status === 'MLE'
              ? `Memory limit exceeded (${Math.round(memoryKb / 1024)} MB)`
              : runResult.stderr.trim() || meta.message,
      status,
      runMs,
      wallMs,
      memoryKb: memoryUsedKb,
      compileMs,
      exitCode: meta.exitcode,
    };
  } finally {
    await cleanupBox(runBoxId);
    pool.release(runBoxId);
  }
}

export const isolateAdapter: SandboxAdapter = {
  name: 'isolate',
  execute,
};
