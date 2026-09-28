import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SandboxLanguage } from '../../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { outputLimitMessage } from './boxOutput.js';
import { compileCache, type FreshCompileOutcome } from './compileCache.js';
import { getLanguageSpec, resolveArtifactNames } from './languageSpec.js';
import { LanguageSpec, RunOptions, SandboxResult, SandboxStatus } from './types.js';

/**
 * Dev-only adapter: spawns the language runtime directly on the host with no
 * isolation. Intended for `npm run dev` on macOS / Windows where `isolate`
 * isn't available. Production must not reach this path — sandboxService
 * refuses to register it when NODE_ENV === 'production'.
 *
 * What's missing vs isolate (knowingly):
 *   · No filesystem isolation. User code can read whatever the codemare user
 *     can read on the host.
 *   · No network isolation. User code can hit the internet.
 *   · No memory cap enforcement. The wrapper-reported `memoryKb` is honest
 *     (it measures the function's allocations) but we don't OOM-kill.
 *   · CPU pinning is a no-op (no cgroups).
 *
 * What still works:
 *   · Wall-time timeout via setTimeout + SIGKILL.
 *   · The per-language wrapper still emits accurate runMs / peakBytes for
 *     Python and JavaScript Problems mode.
 *   · stdin/stdout flow is identical so IDE mode behaves the same as in prod.
 *   · Live stdout (RunOptions.onStdout), which isolate can't offer because
 *     it writes stdout to a file read after the run.
 */
let warned = false;
function warnOnce(): void {
  if (warned) return;
  warned = true;
  // eslint-disable-next-line no-console
  console.warn(
    '\x1b[33m' +
      'WARN: running with localAdapter — user code runs unsandboxed on this host.\n' +
      '      For production, deploy with isolate via deploy/install.sh.' +
      '\x1b[0m'
  );
}

/** Output beyond this (UTF-16 units, ~bytes) is not collected; the process
 *  is killed (RE, "Output limit exceeded") — the same cap isolate enforces
 *  with --fsize. */
const MAX_OUTPUT_BYTES = SANDBOX_CONFIG.limits.outputKb * 1024;

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  wallMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
  aborted: boolean;
}

/**
 * The environment a learner's program (and its compiler) starts with. Never
 * the server's own: that leaks host secrets to user code and leaks settings
 * like FORCE_COLOR that change program output (ANSI codes then fail the
 * judge). isolate clears the environment the same way in production.
 */
function childBaseEnv(cwd: string): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: cwd,
    TMPDIR: cwd,
    LANG: process.env.LANG || 'en_US.UTF-8',
    PYTHONIOENCODING: 'utf-8',
  };
  // Toolchain locators only — never credentials.
  for (const key of ['LC_ALL', 'JAVA_HOME', 'DEVELOPER_DIR', 'SDKROOT'] as const) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function runProcess(
  argv: string[],
  cwd: string,
  options: {
    stdinPath?: string;
    timeoutMs: number;
    env?: Record<string, string>;
    onStdout?: (chunk: string) => void;
    signal?: AbortSignal;
  }
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...childBaseEnv(cwd), ...options.env },
    });

    let stdout = '';
    let stderr = '';
    let outBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let aborted = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    const onAbort = (): void => {
      aborted = true;
      child.kill('SIGKILL');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // setEncoding decodes through a StringDecoder, so a multi-byte UTF-8
    // character split across two chunks isn't mangled.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      if (outputExceeded) return;
      outBytes += text.length;
      if (outBytes > MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        child.kill('SIGKILL');
        return;
      }
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on('data', (text: string) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += text;
    });
    // A program that exits without draining stdin makes the pipe write fail
    // with EPIPE; without a listener that error would crash this process.
    child.stdin.on('error', () => undefined);

    const cleanup = (): void => {
      clearTimeout(killTimer);
      options.signal?.removeEventListener('abort', onAbort);
    };

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });

    child.on('close', (code, signal) => {
      cleanup();
      const wallMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      resolve({ stdout, stderr, exitCode: code, signal, wallMs, timedOut, outputExceeded, aborted });
    });

    if (options.stdinPath) {
      const input = createReadStream(options.stdinPath);
      input.on('error', (e) => reject(e));
      input.pipe(child.stdin);
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Compile into a standalone temp dir that outlives the run dir. This is the
 * compile-cache thunk for the local adapter — same contract as the isolate
 * adapter's, so both share one CompileCache instance.
 */
async function compileLocalToDir(
  spec: LanguageSpec,
  mainFile: string,
  code: string,
  artifactNames: string[],
  compileTimeoutMs: number
): Promise<FreshCompileOutcome> {
  const compileDir = await mkdtemp(path.join(os.tmpdir(), 'codemare-art-'));
  await writeFile(path.join(compileDir, mainFile), code);
  const res = await runProcess(spec.compileArgv!(mainFile), compileDir, {
    timeoutMs: compileTimeoutMs,
    env: spec.compileEnv?.('local'),
  });
  if (res.timedOut || res.exitCode !== 0) {
    await rm(compileDir, { recursive: true, force: true }).catch(() => undefined);
    return {
      kind: 'fail',
      result: {
        output: '',
        error: res.timedOut
          ? `Compilation timed out (${compileTimeoutMs} ms)`
          : res.stderr || 'Compilation failed',
        status: 'CE',
        runMs: 0,
        wallMs: res.wallMs,
        memoryKb: 0,
        compileMs: res.wallMs,
        exitCode: res.exitCode ?? undefined,
      },
    };
  }
  // Artifact patterns may contain globs (java: '*.class') — resolve them to
  // concrete file names now, while we're looking at the compile output.
  const resolved = await resolveArtifactNames(compileDir, artifactNames);
  return { kind: 'ok', dir: compileDir, artifacts: resolved, compileMs: res.wallMs };
}

function abortedResult(compileMs?: number): SandboxResult {
  return {
    output: '',
    error: 'Run cancelled',
    status: 'XX',
    runMs: 0,
    wallMs: 0,
    memoryKb: 0,
    compileMs,
  };
}

export async function executeLocal(
  language: SandboxLanguage,
  code: string,
  input: string,
  options?: RunOptions
): Promise<SandboxResult> {
  warnOnce();

  const timeoutMs = options?.timeoutMs ?? SANDBOX_CONFIG.limits.timeoutMs;
  const memoryKb = options?.memoryKb ?? SANDBOX_CONFIG.limits.memoryKb;
  const compileTimeoutMs = SANDBOX_CONFIG.compileLimits.timeoutMs;
  const spec = getLanguageSpec(language);
  const signal = options?.signal;
  if (signal?.aborted) return abortedResult();

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codemare-local-'));

  try {
    const mainFile = spec.mainFileName(code);
    const stdinPath = path.join(tmpDir, 'stdin.txt');
    await writeFile(stdinPath, input);

    let compileMs: number | undefined;
    if (spec.needsCompile && spec.compileArgv) {
      const artifactNames = spec.artifacts!(mainFile);
      const thunk = (): Promise<FreshCompileOutcome> =>
        compileLocalToDir(spec, mainFile, code, artifactNames, compileTimeoutMs);

      // Same compile-cache path as the isolate adapter: a re-run of unchanged
      // code skips compilation. When disabled, run once and clean up the
      // throwaway artifact dir.
      let artifactDir: string;
      let resolvedArtifacts: string[];
      let ownDir = false;
      if (SANDBOX_CONFIG.compileCache.enabled) {
        const key = compileCache.key(language, spec.compileArgv(mainFile), code);
        // A cache hit is not a compile — only report the phase when one
        // actually runs (or we wait on an identical in-flight compile).
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
            cp(path.join(artifactDir, name), path.join(tmpDir, name))
          )
        );
      } finally {
        if (ownDir) await rm(artifactDir, { recursive: true, force: true }).catch(() => undefined);
      }
    } else {
      await writeFile(path.join(tmpDir, mainFile), code);
    }

    if (signal?.aborted) return abortedResult(compileMs);
    options?.onPhase?.('running');
    const runResult = await runProcess(spec.runArgv(mainFile), tmpDir, {
      timeoutMs,
      stdinPath,
      env: spec.runEnv?.('local', { memoryKb }),
      onStdout: options?.onStdout,
      signal,
    });
    if (runResult.aborted) return abortedResult(compileMs);

    const status = classify(runResult);
    return {
      output: runResult.stdout,
      // A timeout kill leaves no stderr and a null exit code — report a human
      // message instead of the meaningless "exit null".
      error:
        status === 'OK'
          ? undefined
          : status === 'TLE'
            ? `Time limit exceeded (${timeoutMs} ms)`
            : runResult.outputExceeded
              ? outputLimitMessage(MAX_OUTPUT_BYTES)
              : runResult.stderr ||
                (runResult.signal
                  ? `Process killed by ${runResult.signal}`
                  : `exit ${runResult.exitCode}`),
      status,
      // Without a meta file, runMs falls back to wall. The harness's own
      // per-test CPU timings (runNs, inside the user process) are what a run
      // actually reports — see runService.
      runMs: runResult.wallMs,
      wallMs: runResult.wallMs,
      memoryKb: 0,
      compileMs,
      exitCode: runResult.exitCode ?? undefined,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function classify(outcome: SpawnOutcome): SandboxStatus {
  if (outcome.outputExceeded) return 'RE';
  if (outcome.timedOut) return 'TLE';
  if (outcome.signal === 'SIGKILL') return 'TLE';
  if (outcome.exitCode === 0) return 'OK';
  return 'RE';
}
