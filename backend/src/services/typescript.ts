import type TS from 'typescript';
import { joinSources, locateLine, SourceSegment } from './sourceAssembly.js';

/**
 * TypeScript support: transpile to JavaScript in the API process, then run
 * through the JavaScript harness / runtime.
 *
 * Transpile-only (ts.transpileModule): types are erased, not checked — the
 * same trade-off as ts-node --transpile-only / esbuild. Only syntax errors
 * are reported, and they become a CE with file:line:col relative to the
 * learner's own code (prelude pieces keep their own names). `typescript` is
 * pure JavaScript, so the release (which rsyncs node_modules built on the
 * dev machine) needs no platform binary; it is loaded lazily and warmed by
 * the startup readiness probe.
 */

let tsModule: Promise<typeof TS> | undefined;

function loadTypeScript(): Promise<typeof TS> {
  tsModule ??= import('typescript').then((m) => ((m as { default?: typeof TS }).default ?? m) as typeof TS);
  return tsModule;
}

export type TranspileResult =
  | { ok: true; js: string; ms: number }
  | { ok: false; error: string; ms: number };

const MAX_DIAGNOSTICS = 20;

function formatDiagnostic(
  ts: typeof TS,
  d: TS.Diagnostic,
  segments: readonly SourceSegment[],
  lines: readonly string[]
): string {
  const text = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  if (!d.file || d.start === undefined) return `error TS${d.code}: ${text}`;
  const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
  const where = locateLine(segments, line + 1) ?? { name: 'solution.ts', line: line + 1 };
  const source = lines[line] ?? '';
  const gutter = String(where.line);
  const frame =
    source.trim() === ''
      ? ''
      : `\n  ${gutter} | ${source}\n  ${' '.repeat(gutter.length)} | ${' '.repeat(character)}^`;
  return `${where.name}:${where.line}:${character + 1} - error TS${d.code}: ${text}${frame}`;
}

/** Transpile `code` (with any prelude pieces before it) to CommonJS. */
export async function transpileTypeScript(
  code: string,
  prelude: readonly string[] = []
): Promise<TranspileResult> {
  const ts = await loadTypeScript();
  const started = performance.now();
  const joined = joinSources('typescript', prelude, code);
  const out = ts.transpileModule(joined.source, {
    fileName: 'solution.ts',
    reportDiagnostics: true,
    compilerOptions: {
      // Node 20 runs ES2022 natively; CommonJS because the JS harness (and
      // IDE programs) run as a plain `node main.js` script.
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const ms = performance.now() - started;
  const errors = (out.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  if (errors.length > 0) {
    const lines = joined.source.split('\n');
    const shown = errors
      .slice(0, MAX_DIAGNOSTICS)
      .map((d) => formatDiagnostic(ts, d, joined.segments, lines));
    if (errors.length > MAX_DIAGNOSTICS) {
      shown.push(`… ${errors.length - MAX_DIAGNOSTICS} more error(s)`);
    }
    return { ok: false, error: shown.join('\n\n'), ms };
  }
  return { ok: true, js: out.outputText, ms };
}
