import { Language } from '../models/ExecutionResult.js';
import { isolateAdapter } from './sandbox/isolateAdapter.js';
import { RunOptions, SandboxResult } from './sandbox/types.js';

/**
 * Single entry point for executing user code. The backend now runs only on
 * Linux with `isolate` — there is no longer a strategy facade selecting between
 * Docker / direct / isolate, because Docker and the macOS dev fallback were
 * removed in Phase 6.
 */
export async function executeSandboxed(
  language: Language,
  code: string,
  input: string,
  options?: RunOptions
): Promise<SandboxResult> {
  return isolateAdapter.execute(language, code, input, options);
}

/**
 * Probe the runtime stack at startup: run a trivial program for each language.
 * Failures are reported per-language and do NOT block startup — a missing JDK
 * should disable Java rather than take the service down.
 */
export async function sandboxReadinessProbe(): Promise<{
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
        const res = await isolateAdapter.execute(lang, code, input);
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

  return { available, unavailable };
}
