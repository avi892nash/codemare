import { spawnSync } from 'node:child_process';
import { Language } from '../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../config/sandbox.js';
import { isolateAdapter } from './sandbox/isolateAdapter.js';
import { executeLocal } from './sandbox/localAdapter.js';
import { RunOptions, SandboxResult } from './sandbox/types.js';

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
 */
export async function executeSandboxed(
  language: Language,
  code: string,
  input: string,
  options?: RunOptions
): Promise<SandboxResult> {
  return SANDBOX_BACKEND === 'isolate'
    ? isolateAdapter.execute(language, code, input, options)
    : executeLocal(language, code, input, options);
}

/**
 * Probe the runtime stack at startup: run a trivial program for each language.
 * Failures are reported per-language and do NOT block startup — a missing JDK
 * should disable Java rather than take the service down.
 */
export async function sandboxReadinessProbe(): Promise<{
  backend: BackendName;
  available: Language[];
  unavailable: Array<{ language: Language; reason: string }>;
}> {
  const probes: Array<{ lang: Language; code: string; expect: string; input: string }> = [
    { lang: 'python',     code: 'print("ok")',                                                                            expect: 'ok', input: '' },
    { lang: 'javascript', code: 'console.log("ok")',                                                                      expect: 'ok', input: '' },
    { lang: 'cpp',        code: '#include<iostream>\nint main(){std::cout<<"ok";return 0;}',                              expect: 'ok', input: '' },
    { lang: 'java',       code: 'public class Main { public static void main(String[] a){ System.out.println("ok"); } }', expect: 'ok', input: '' },
  ];

  const available: Language[] = [];
  const unavailable: Array<{ language: Language; reason: string }> = [];

  await Promise.all(
    probes.map(async ({ lang, code, expect, input }) => {
      try {
        const res = await executeSandboxed(lang, code, input);
        if (res.status === 'OK' && res.output.trim() === expect) {
          available.push(lang);
        } else {
          unavailable.push({
            language: lang,
            reason: res.error ?? `unexpected output ${JSON.stringify(res.output)}`,
          });
        }
      } catch (err) {
        unavailable.push({
          language: lang,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );

  return { backend: SANDBOX_BACKEND, available, unavailable };
}
