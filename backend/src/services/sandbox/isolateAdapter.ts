import { spawn } from 'node:child_process';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Language } from '../../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { BoxPool } from './boxPool.js';
import { getLanguageSpec } from './languageSpec.js';
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
 */

const pool = new BoxPool(SANDBOX_CONFIG.isolate.maxBoxes);
const META_DIR = '/tmp';

/**
 * Number of physical cores available to pin user submissions onto. Resolved
 * once at startup. We pin each run box to a single core (round-robin by box
 * id) so a user submission cannot parallelise its algorithm to win timing
 * comparisons unfairly — CP-judge convention.
 */
const HOST_CORES = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);

interface IsolateRunSpec {
  argv: string[];
  timeoutMs: number;
  memoryKb: number;
  pidsLimit: number;
  /**
   * Pin the run to one host core (sched_setaffinity via isolate's --core flag).
   * Omit during compile — g++ / javac can use whatever the scheduler gives them.
   */
  cpuCore?: number;
  stdinFile?: string;
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
    `--mem=${spec.memoryKb}`,
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
  args.push('--run', '--', ...spec.argv);

  await runIsolate(args);

  const boxDir = path.join('/var/local/lib/isolate', String(boxId), 'box');
  const [metaText, stdout, stderr] = await Promise.all([
    readFile(metaPath, 'utf8').catch(() => ''),
    readFile(path.join(boxDir, stdoutFile), 'utf8').catch(() => ''),
    readFile(path.join(boxDir, stderrFile), 'utf8').catch(() => ''),
  ]);

  return { metaText, stdout, stderr };
}

async function compileInBox(
  boxId: number,
  boxDir: string,
  spec: LanguageSpec,
  mainFile: string,
  code: string
): Promise<{ compileMs: number; failure?: SandboxResult }> {
  await writeFile(path.join(boxDir, mainFile), code);
  const compileSpec: IsolateRunSpec = {
    argv: spec.compileArgv!(mainFile),
    timeoutMs: SANDBOX_CONFIG.compileLimits.timeoutMs,
    memoryKb: SANDBOX_CONFIG.compileLimits.memoryKb,
    pidsLimit: SANDBOX_CONFIG.compileLimits.pidsLimit,
  };
  const result = await runInBox(boxId, compileSpec);
  const meta = parseIsolateMeta(result.metaText);
  const compileMs = (meta.timeWall ?? meta.time ?? 0) * 1000;

  if (mapMetaToStatus(meta) !== 'OK') {
    return {
      compileMs,
      failure: {
        output: '',
        error: result.stderr.trim() || meta.message || 'Compilation failed',
        status: 'CE',
        runMs: 0,
        wallMs: compileMs,
        memoryKb: meta.cgMem ?? meta.maxRss ?? 0,
        compileMs,
        exitCode: meta.exitcode,
      },
    };
  }
  return { compileMs };
}

async function copyArtifact(
  fromDir: string,
  toDir: string,
  language: Language,
  mainFile: string
): Promise<void> {
  if (language === 'cpp') {
    await copyFile(path.join(fromDir, 'a.out'), path.join(toDir, 'a.out'));
    return;
  }
  if (language === 'java') {
    const className = mainFile.replace(/\.java$/, '');
    await copyFile(
      path.join(fromDir, `${className}.class`),
      path.join(toDir, `${className}.class`)
    );
  }
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

  const runBoxId = await pool.acquire();
  let compileBoxId: number | undefined;
  let compileMs: number | undefined;

  try {
    const runBoxDir = await initBox(runBoxId);

    if (spec.needsCompile) {
      compileBoxId = await pool.acquire();
      const compileBoxDir = await initBox(compileBoxId);
      const compileResult = await compileInBox(
        compileBoxId,
        compileBoxDir,
        spec,
        mainFile,
        code
      );
      compileMs = compileResult.compileMs;
      if (compileResult.failure) {
        return compileResult.failure;
      }
      await copyArtifact(compileBoxDir, runBoxDir, language, mainFile);
    } else {
      await writeFile(path.join(runBoxDir, mainFile), code);
    }

    await writeFile(path.join(runBoxDir, 'stdin.txt'), input);

    const runResult = await runInBox(runBoxId, {
      argv: spec.runArgv(mainFile),
      timeoutMs,
      memoryKb,
      pidsLimit,
      // Round-robin core assignment across concurrent submissions so we don't
      // pile every box onto core 0. Each box still sees exactly one core,
      // which is what guarantees fair timing.
      cpuCore: runBoxId % HOST_CORES,
      stdinFile: 'stdin.txt',
    });

    const meta = parseIsolateMeta(runResult.metaText);
    const status = mapMetaToStatus(meta);
    const runMs = (meta.time ?? 0) * 1000;
    const wallMs = (meta.timeWall ?? meta.time ?? 0) * 1000;
    const memoryUsedKb = meta.cgMem ?? meta.maxRss ?? 0;

    return {
      output: runResult.stdout,
      error: status === 'OK' ? undefined : runResult.stderr.trim() || meta.message,
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
    if (compileBoxId !== undefined) {
      await cleanupBox(compileBoxId);
      pool.release(compileBoxId);
    }
  }
}

export const isolateAdapter: SandboxAdapter = {
  name: 'isolate',
  execute,
};
