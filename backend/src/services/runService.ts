import vm from 'node:vm';
import { Language, SandboxLanguage } from '../models/ExecutionResult.js';
import { TestCase } from '../models/Problem.js';
import { RunResponse, RunStatus, RunTestResult } from '../models/Run.js';
import { parseSignatureType, wrapFunctionCode } from './codeWrapperService.js';
import { HarnessStreamParser, HarnessTestRecord, parseHarnessOutput } from './harnessProtocol.js';
import { ValidatedRunRequest } from './runValidation.js';
import { executeSandboxed } from './sandboxService.js';
import { RunPhase, SandboxResult } from './sandbox/types.js';
import { joinSources, locateLine, SourceSegment } from './sourceAssembly.js';
import { transpileTypeScript } from './typescript.js';
import { deepEqual, DeepEqualOptions, deriveVerdict } from './validationService.js';

/**
 * The pure executor behind POST /v1/run and /v1/run/stream: caller-supplied
 * code + tests in, per-test results and a derived verdict out.
 *
 * Verdicts (decision 12 — derived, never echoed):
 *   CE  compiler / transpiler / syntax error (no tests ran; `tests` is empty)
 *   XX  platform-side failure (sandbox error, harness-declared error)
 *   TLE / MLE / RE  the sandbox's own status, passed through. Tests that
 *       finished before the process died keep their results; the test that
 *       was running carries the reason; later ones are "not run".
 *   RE  also: a clean exit before the harness finished (the code called exit)
 *   OK / WA  a clean, complete run: every test passed / at least one didn't
 *            (a per-test exception is a failed test → WA)
 *
 * Every `passed` is decided here: the function's output against the request's
 * expected value, honouring compareMode, with a 1e-6 tolerance when the
 * signature returns double(s). For Python/JavaScript/TypeScript the expected
 * values never even enter the sandbox (the harness gets inputs only), and the
 * Go harness never embeds them, so a submission can't read the answers it is
 * judged against. (C++/Java still embed them: their generators need the typed
 * literal — digging them out of a compiled binary is the residual risk.)
 */

export interface RunHooks {
  /** Deduplicated and monotonic: queued → compiling → running, each at most once. */
  onPhase?: (phase: RunPhase) => void;
  /** Per-test results, always in index order, as soon as each is known. */
  onTest?: (result: RunTestResult) => void;
  /** Abort when the caller goes away (see RunOptions.signal). */
  signal?: AbortSignal;
}

const PHASE_ORDER: Record<RunPhase, number> = { queued: 0, compiling: 1, running: 2 };
const FLOAT_TOLERANCE = 1e-6;
const MAX_ERROR_CHARS = 8000;
const MAX_TEST_ERROR_CHARS = 1000;
const NOT_RUN = 'Not run: the program stopped at an earlier test';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

/**
 * Learner-controlled text is bounded before any further processing:
 * compiler output is kept from the top (truncate); a crash's stderr from
 * whichever end its language reports the reason at (see crashOutput).
 */
function tail(text: string, max: number): string {
  return text.length > max ? `(truncated) …\n${text.slice(text.length - max)}` : text;
}

const SANDBOX_DIR = /(?:\/box|codemare-(?:art|local)-[A-Za-z0-9]+)\//g;

/**
 * Drop sandbox/tmp directory prefixes so messages say `main.py`, not
 * `/box/main.py`. A linear scan (path-like tokens, then the last sandbox
 * directory in each) — the input is learner-controlled, so no backtracking
 * regex over it.
 */
function stripSandboxPaths(text: string): string {
  return text.replace(/[^\s"'():]+/g, (token) => {
    if (!token.startsWith('/')) return token;
    let cut = -1;
    for (const m of token.matchAll(SANDBOX_DIR)) cut = (m.index ?? 0) + m[0].length;
    return cut >= 0 ? token.slice(cut) : token;
  });
}

/** Rewrite `File "main.py", line N` / `main.js:N` to the learner's own file and line. */
function mapScriptLines(text: string, file: string, segments: readonly SourceSegment[]): string {
  const harness = file.replace(/^main/, 'harness');
  const escaped = file.replace('.', '\\.');
  return text
    .replace(new RegExp(`File "${escaped}", line (\\d+)`, 'g'), (_m, n: string) => {
      const loc = locateLine(segments, Number(n));
      return loc ? `File "${loc.name}", line ${loc.line}` : `File "${harness}", line ${n}`;
    })
    .replace(new RegExp(`(^|[\\s(])${escaped}:(\\d+)`, 'g'), (_m, pre: string, n: string) => {
      const loc = locateLine(segments, Number(n));
      return `${pre}${loc ? `${loc.name}:${loc.line}` : `${harness}:${n}`}`;
    });
}

function cleanCompilerOutput(text: string): string {
  const cleaned = stripSandboxPaths(truncate(text, MAX_ERROR_CHARS))
    .split('\n')
    // go build's package header line.
    .filter((line) => !/^# command-line-arguments\s*$/.test(line))
    .join('\n')
    .trim();
  return truncate(cleaned || 'Compilation failed', MAX_ERROR_CHARS);
}

/**
 * JavaScript is interpreted, but a syntax error is still a compile error:
 * parse the code the way Node's CommonJS loader will (compileFunction with
 * the module wrapper's parameters) without running anything.
 */
function javascriptSyntaxError(prelude: readonly string[], code: string): string | undefined {
  const joined = joinSources('javascript', prelude, code);
  try {
    vm.compileFunction(joined.source, ['exports', 'require', 'module', '__filename', '__dirname'], {
      filename: 'main.js',
    });
    return undefined;
  } catch (err) {
    if (!(err instanceof SyntaxError)) return undefined;
    const stack = truncate(String(err.stack ?? `${err.name}: ${err.message}`), MAX_ERROR_CHARS);
    const head = stack.split('\n    at ')[0].trim();
    const mapped = mapScriptLines(head, 'main.js', joined.segments);
    return truncate(mapped.includes('SyntaxError') ? mapped : `SyntaxError: ${err.message}`, MAX_ERROR_CHARS);
  }
}

/**
 * Python compiles the whole file before running any of it, so a syntax error
 * surfaces as a failed run with no harness output and a SyntaxError (with no
 * traceback — a runtime SyntaxError, e.g. from eval, has one).
 */
function pythonSyntaxError(stderr: string, segments: readonly SourceSegment[]): string | undefined {
  const text = tail(stderr.trim(), MAX_ERROR_CHARS);
  if (text === '' || text.includes('Traceback (most recent call last)')) return undefined;
  const last = text.split('\n').pop() ?? '';
  if (!/^(SyntaxError|IndentationError|TabError)\b/.test(last)) return undefined;
  return truncate(mapScriptLines(stripSandboxPaths(text), 'main.py', segments), MAX_ERROR_CHARS);
}

/**
 * A crash's stderr, bounded: Python puts the error last (after the
 * traceback), everything else first (Go's "fatal error:" / "panic:", Java's
 * "Exception in thread", libstdc++'s "terminate called", Node's thrown error)
 * followed by long stack dumps.
 */
function crashOutput(stderr: string, language: Language): string {
  const text = stderr.trim();
  return stripSandboxPaths(
    language === 'python' ? tail(text, MAX_ERROR_CHARS) : truncate(text, MAX_ERROR_CHARS)
  );
}

const KEY_ERROR_LINE =
  /^(?:panic: |fatal error: |Exception in thread |terminate called|Uncaught |[A-Za-z]*Error\b)/;

/** The one line of a crash's stderr that says what happened. */
function keyErrorLine(stderr: string, language: Language): string {
  const lines = crashOutput(stderr, language)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('(truncated)') && !l.startsWith('…'));
  if (lines.length === 0) return '';
  if (language === 'python') return lines[lines.length - 1];
  return lines.find((l) => KEY_ERROR_LINE.test(l)) ?? lines[0];
}

/** Error for the test that was running when the process stopped. */
function stoppedAtMessage(sandbox: SandboxResult, language: Language): string {
  switch (sandbox.status) {
    case 'TLE':
      return 'Time limit exceeded';
    case 'MLE':
      return 'Memory limit exceeded';
    case 'RE': {
      const detail = keyErrorLine(sandbox.error ?? '', language);
      return truncate(detail ? `Runtime error: ${detail}` : 'Runtime error', MAX_TEST_ERROR_CHARS);
    }
    default:
      return 'The program exited before reporting a result';
  }
}

function toUs(ns: number | undefined): number {
  return ns === undefined ? 0 : Math.round(ns / 1000);
}

function toKb(bytes: number | undefined): number {
  return bytes ? Math.ceil(bytes / 1024) : 0;
}

function early(status: RunStatus, totalTests: number, error: string, compileMs?: number): RunResponse {
  return {
    status,
    totalPassed: 0,
    totalTests,
    runUs: 0,
    memoryKb: 0,
    ...(compileMs !== undefined ? { compileMs } : {}),
    error: truncate(error, MAX_ERROR_CHARS),
    tests: [],
  };
}

export async function executeRun(
  req: ValidatedRunRequest,
  hooks: RunHooks = {}
): Promise<RunResponse> {
  const n = req.tests.length;
  let lastPhase = -1;
  const phase = (p: RunPhase): void => {
    if (PHASE_ORDER[p] <= lastPhase) return;
    lastPhase = PHASE_ORDER[p];
    hooks.onPhase?.(p);
  };
  const compare: DeepEqualOptions = {
    floatTolerance:
      req.signature && parseSignatureType(req.signature.returns).base === 'double'
        ? FLOAT_TOLERANCE
        : undefined,
  };

  const fromRecord = (i: number, rec: HarnessTestRecord): RunTestResult => {
    const spec = req.tests[i];
    const actual = rec.output === undefined ? null : rec.output;
    const passed =
      rec.error === undefined && deepEqual(actual, spec.expected, req.compareMode, compare);
    return {
      idx: i,
      hidden: spec.hidden,
      passed,
      runUs: toUs(rec.runNs),
      wallUs: toUs(rec.wallNs),
      memoryKb: toKb(rec.peakBytes),
      actual,
      ...(rec.error !== undefined ? { error: truncate(rec.error, MAX_TEST_ERROR_CHARS) } : {}),
    };
  };
  const missing = (i: number, error: string): RunTestResult => ({
    idx: i,
    hidden: req.tests[i].hidden,
    passed: false,
    runUs: 0,
    wallUs: 0,
    memoryKb: 0,
    actual: null,
    error,
  });

  try {
    // 1. Language front ends.
    let language: SandboxLanguage;
    let code = req.code;
    let prelude: readonly string[] = req.prelude;
    let compileMs: number | undefined;
    if (req.language === 'typescript') {
      phase('compiling');
      const ts = await transpileTypeScript(req.code, req.prelude);
      compileMs = Math.round(ts.ms);
      if (!ts.ok) return early('CE', n, ts.error, compileMs);
      language = 'javascript';
      code = ts.js;
      prelude = []; // already part of the transpiled module
    } else {
      language = req.language;
      if (language === 'javascript') {
        const syntax = javascriptSyntaxError(req.prelude, req.code);
        if (syntax) return early('CE', n, syntax);
      }
    }

    // 2. Harness. Only the C++/Java generators need expected values (they
    //    emit typed literals for them); everyone else gets inputs only.
    const embedExpected = language === 'cpp' || language === 'java';
    const testCases: TestCase[] = req.tests.map((t) => ({
      input: t.input,
      expectedOutput: embedExpected ? t.expected : null,
      hidden: t.hidden,
    }));
    const { wrappedCode, input } = wrapFunctionCode(
      code,
      req.functionName,
      testCases,
      language,
      req.compareMode,
      req.signature,
      prelude
    );

    // 3. Run, turning harness records into in-order test results as they
    //    arrive (live on the local adapter; after exit on isolate).
    const results: Array<RunTestResult | undefined> = new Array(n);
    let next = 0;
    const pending = new Map<number, HarnessTestRecord>();
    const drain = (): void => {
      while (next < n && pending.has(next)) {
        const r = fromRecord(next, pending.get(next)!);
        pending.delete(next);
        results[next] = r;
        hooks.onTest?.(r);
        next++;
      }
    };
    const stream = hooks.onTest ? new HarnessStreamParser() : undefined;

    const sandbox = await executeSandboxed(language, wrappedCode, input, {
      timeoutMs: req.limits.timeMs,
      memoryKb: req.limits.memoryMb * 1024,
      onPhase: phase,
      onStdout: stream
        ? (chunk) => {
            for (const rec of stream.push(chunk)) if (rec.i < n) pending.set(rec.i, rec);
            drain();
          }
        : undefined,
      signal: hooks.signal,
    });
    if (compileMs === undefined && sandbox.compileMs !== undefined) {
      compileMs = Math.round(sandbox.compileMs);
    }

    if (sandbox.status === 'CE') {
      return early('CE', n, cleanCompilerOutput(sandbox.error ?? ''), compileMs);
    }
    if (sandbox.status === 'XX') {
      return early('XX', n, sandbox.error ?? 'Internal error', compileMs);
    }

    const parsed = parseHarnessOutput(sandbox.output);
    const nothingReported = parsed.tests.size === 0 && !parsed.summary;
    // Line maps for the interpreted languages whose files we can map back
    // (TypeScript's lines are the transpiler's, so it is left as is).
    const script =
      req.language === 'python' || req.language === 'javascript'
        ? {
            file: req.language === 'python' ? 'main.py' : 'main.js',
            segments: joinSources(req.language, req.prelude, req.code).segments,
          }
        : undefined;
    const pySegments = req.language === 'python' ? script?.segments : undefined;
    if (pySegments && sandbox.status === 'RE' && nothingReported) {
      const syntax = pythonSyntaxError(sandbox.error ?? '', pySegments);
      if (syntax) return early('CE', n, syntax, compileMs);
    }
    if (parsed.summary?.error) {
      return early('XX', n, parsed.summary.error, compileMs);
    }

    // 4. Remaining results, in order.
    let stopped = false;
    for (let i = next; i < n; i++) {
      const rec = parsed.tests.get(i);
      let r: RunTestResult;
      if (rec) {
        r = fromRecord(i, rec);
      } else {
        r = missing(i, stopped ? NOT_RUN : stoppedAtMessage(sandbox, req.language));
        stopped = true;
      }
      results[i] = r;
      hooks.onTest?.(r);
    }
    const tests = results as RunTestResult[];

    // 5. Verdict.
    const totalPassed = tests.filter((t) => t.passed).length;
    let status: RunStatus;
    let error: string | undefined;
    if (sandbox.status !== 'OK') {
      status = sandbox.status;
      let detail = crashOutput(sandbox.error ?? '', req.language);
      if (script) detail = mapScriptLines(detail, script.file, script.segments);
      error = detail || status;
    } else if (!parsed.summary) {
      status = 'RE';
      error = 'The program exited before all tests ran (did the code call exit?)';
    } else {
      status = deriveVerdict('OK', totalPassed, n) as RunStatus;
    }

    return {
      status,
      totalPassed,
      totalTests: n,
      runUs: tests.reduce((sum, t) => sum + t.runUs, 0),
      memoryKb: Math.max(0, toKb(parsed.summary?.peakBytes), ...tests.map((t) => t.memoryKb)),
      ...(compileMs !== undefined ? { compileMs } : {}),
      ...(error !== undefined ? { error } : {}),
      tests,
    };
  } catch (err) {
    console.error('run failed:', err);
    return early('XX', n, `Internal error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
