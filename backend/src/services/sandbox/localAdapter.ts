import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Language } from '../../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { getLanguageSpec } from './languageSpec.js';
import { RunOptions, SandboxResult, SandboxStatus } from './types.js';

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

interface SpawnOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  wallMs: number;
  timedOut: boolean;
}

function runProcess(
  argv: string[],
  cwd: string,
  options: { stdinPath?: string; timeoutMs: number }
): Promise<SpawnOutcome> {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      const wallMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      resolve({ stdout, stderr, exitCode: code, signal, wallMs, timedOut });
    });

    if (options.stdinPath) {
      import('node:fs').then((fs) => {
        const input = fs.createReadStream(options.stdinPath as string);
        input.on('error', (e) => reject(e));
        input.pipe(child.stdin);
      });
    } else {
      child.stdin.end();
    }
  });
}

export async function executeLocal(
  language: Language,
  code: string,
  input: string,
  options?: RunOptions
): Promise<SandboxResult> {
  warnOnce();

  const timeoutMs = options?.timeoutMs ?? SANDBOX_CONFIG.limits.timeoutMs;
  const compileTimeoutMs = SANDBOX_CONFIG.compileLimits.timeoutMs;
  const spec = getLanguageSpec(language);

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codemare-local-'));
  const wallStart = process.hrtime.bigint();

  try {
    const mainFile = spec.mainFileName(code);
    await writeFile(path.join(tmpDir, mainFile), code);
    const stdinPath = path.join(tmpDir, 'stdin.txt');
    await writeFile(stdinPath, input);

    let compileMs: number | undefined;
    if (spec.needsCompile && spec.compileArgv) {
      const compileResult = await runProcess(spec.compileArgv(mainFile), tmpDir, {
        timeoutMs: compileTimeoutMs,
      });
      compileMs = compileResult.wallMs;
      if (compileResult.timedOut || compileResult.exitCode !== 0) {
        return {
          output: '',
          error: compileResult.stderr || 'Compilation failed',
          status: 'CE',
          runMs: 0,
          wallMs: Number(process.hrtime.bigint() - wallStart) / 1_000_000,
          memoryKb: 0,
          compileMs,
          exitCode: compileResult.exitCode ?? undefined,
        };
      }
    }

    const runResult = await runProcess(spec.runArgv(mainFile), tmpDir, {
      timeoutMs,
      stdinPath,
    });

    const status = classify(runResult);
    return {
      output: runResult.stdout,
      error:
        status === 'OK' ? undefined : runResult.stderr || `exit ${runResult.exitCode}`,
      status,
      // Without a meta file, runMs falls back to wall. The wrapper-emitted
      // totalRunNs (inside the user process) is what the response actually
      // surfaces for Py/JS — see executionService.
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
  if (outcome.timedOut) return 'TLE';
  if (outcome.signal === 'SIGKILL') return 'TLE';
  if (outcome.exitCode === 0) return 'OK';
  return 'RE';
}

