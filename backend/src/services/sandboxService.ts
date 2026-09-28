import { spawnSync } from 'node:child_process';
import { Language, SandboxLanguage } from '../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../config/sandbox.js';
import { checkCpuPinning, cpuPinning, isolateAdapter, PinningCheck } from './sandbox/isolateAdapter.js';
import { executeLocal } from './sandbox/localAdapter.js';
import { disableSharedGoCache, sharedGoCacheEnabled } from './sandbox/goToolchain.js';
import { RunOptions, SandboxResult } from './sandbox/types.js';
import { transpileTypeScript } from './typescript.js';

/**
 * Selects the execution backend exactly once at module load.
 *
 *   1. If `SANDBOX_MODE=local` (or `=isolate`) is set explicitly, honour it.
 *   2. Otherwise: try isolate (Linux + binary on PATH). On Linux without
 *      isolate, or any non-Linux host, fall back to the local adapter.
 *   3. In production (`NODE_ENV=production`) the local adapter is REFUSED —
 *      the process throws at startup so we never silently ship unsandboxed
 *      execution.
 *
 * The selection runs synchronously at import time so requests don't pay the
 * `which isolate` cost on every call.
 */
type BackendName = 'isolate' | 'local';

function isIsolateAvailable(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const result = spawnSync(SANDBOX_CONFIG.isolate.binary, ['--version']);
    return result.status === 0;
  } catch {
    return false;
  }
}

function pickBackend(): BackendName {
  const forced = (process.env.SANDBOX_MODE ?? '').toLowerCase().trim();
  if (forced === 'isolate' || forced === 'local') {
    if (forced === 'local' && process.env.NODE_ENV === 'production') {
      throw new Error(
        'SANDBOX_MODE=local is refused in production. ' +
          'Install isolate (see deploy/install.sh) and unset SANDBOX_MODE or set =isolate.'
      );
    }
    return forced;
  }

  if (isIsolateAvailable()) return 'isolate';

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'isolate is not available on this host and NODE_ENV=production. ' +
        'Install it with deploy/install.sh, or run with NODE_ENV=development ' +
        'to use the unsandboxed local adapter.'
    );
  }
  return 'local';
}

export const SANDBOX_BACKEND: BackendName = pickBackend();

/**
 * Single entry point for executing user code. Dispatches to the backend that
 * was selected at module load. The selection is logged once at startup
 * (see server.ts) so the operator always knows which adapter is live.
 * TypeScript never gets here — callers transpile it and pass 'javascript'.
 */
export async function executeSandboxed(
  language: SandboxLanguage,
  code: string,
  input: string,
  options?: RunOptions
): Promise<SandboxResult> {
  return SANDBOX_BACKEND === 'isolate'
    ? isolateAdapter.execute(language, code, input, options)
    : executeLocal(language, code, input, options);
}

/** Run one probe program; resolves to an error message, or undefined when it works. */
async function probeLanguage(lang: Language, code: string, expect: string): Promise<string | undefined> {
  try {
    let runLang: SandboxLanguage;
    let runCode = code;
    if (lang === 'typescript') {
      const ts = await transpileTypeScript(code);
      if (!ts.ok) return ts.error;
      runLang = 'javascript';
      runCode = ts.js;
    } else {
      runLang = lang;
    }
    const res = await executeSandboxed(runLang, runCode, '');
    if (res.status === 'OK' && res.output.trim() === expect) return undefined;
    return res.error ?? `unexpected output ${JSON.stringify(res.output)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Probe the runtime stack at startup: run a trivial program for each language.
 * Failures are reported per-language and do NOT block startup — a missing JDK
 * should disable Java rather than take the service down. The TypeScript probe
 * also loads the compiler, so the first real TS request doesn't pay for it.
 *
 * Go under isolate compiles against the read-only shared build cache; if that
 * probe fails, the shared cache is switched off and Go is probed again with a
 * private per-box cache, so a surprise there costs speed, not the language.
 *
 * Under isolate it also checks CPU pinning (decision 03) from inside a run
 * box. Pinning that is on but cannot be applied at all (no taskset, unknown
 * CPUs) throws: the service refuses to start rather than run boxes unpinned.
 */
export async function sandboxReadinessProbe(): Promise<{
  backend: BackendName;
  available: Language[];
  unavailable: Array<{ language: Language; reason: string }>;
  pinning: PinningCheck;
}> {
  // Before any box starts, so a pinning misconfiguration fails the boot.
  if (SANDBOX_BACKEND === 'isolate') cpuPinning();

  const goProgram = (tag: string) =>
    `package main\n\nimport "fmt"\n\n// probe ${tag}\nfunc main() { fmt.Println("ok") }\n`;
  const probes: Array<{ lang: Language; code: string }> = [
    { lang: 'python',     code: 'print("ok")' },
    { lang: 'javascript', code: 'console.log("ok")' },
    { lang: 'typescript', code: 'const s: string = "ok";\nconsole.log(s);' },
    { lang: 'cpp',        code: '#include<iostream>\nint main(){std::cout<<"ok";return 0;}' },
    { lang: 'java',       code: 'public class Main { public static void main(String[] a){ System.out.println("ok"); } }' },
    { lang: 'go',         code: goProgram('shared-cache') },
  ];

  const results = await Promise.all(
    probes.map(async ({ lang, code }) => ({ lang, reason: await probeLanguage(lang, code, 'ok') }))
  );

  const go = results.find((r) => r.lang === 'go')!;
  if (go.reason !== undefined && SANDBOX_BACKEND === 'isolate' && sharedGoCacheEnabled()) {
    disableSharedGoCache();
    // A different source, or the compile cache would replay the failure.
    const retry = await probeLanguage('go', goProgram('private-cache'), 'ok');
    if (retry === undefined) {
      console.warn(
        `  Go: build against the shared cache failed (${go.reason.split('\n')[0]}); ` +
          'using a private per-box cache instead (correct, but every compile is cold)'
      );
    }
    go.reason = retry;
  }

  const pinning: PinningCheck =
    SANDBOX_BACKEND === 'isolate'
      ? await checkCpuPinning()
      : { state: 'off', message: 'not applied (local adapter: no sandbox)' };

  return {
    backend: SANDBOX_BACKEND,
    available: results.filter((r) => r.reason === undefined).map((r) => r.lang),
    unavailable: results
      .filter((r): r is { lang: Language; reason: string } => r.reason !== undefined)
      .map((r) => ({ language: r.lang, reason: r.reason })),
    pinning,
  };
}
