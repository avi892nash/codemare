import { Language } from '../models/ExecutionResult.js';
import {
  CompareMode,
  ProblemSignature,
  SignatureBaseType,
  SignatureType,
  TestCase,
} from '../models/Problem.js';
import { HARNESS_MARK } from './harnessProtocol.js';
import { assembleGo, joinSources, renderGoImports } from './sourceAssembly.js';

/**
 * Wrap user's function code with test harness for stdin/stdout execution.
 * `compareMode: 'unordered'` makes the harness compare array results as
 * multisets (both sides sorted by a canonical key) instead of element order.
 *
 * Python/JavaScript harnesses read the test data from stdin (dynamically
 * typed). C++/Java/Go harnesses require `signature` — the generator embeds
 * every test input (and, for C++/Java, expected output) as typed literals
 * directly in the generated program, so there is no JSON parsing at runtime.
 *
 * Every harness reports results with the line protocol in harnessProtocol.ts
 * (one marker-prefixed JSON record per test as it finishes, then a summary).
 *
 * `prelude` holds dependency sources placed before the user's code (see
 * sourceAssembly.ts). TypeScript is not wrapped directly: it is transpiled
 * first (services/typescript.ts) and wrapped as JavaScript.
 */
export function wrapFunctionCode(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  language: Language,
  compareMode: CompareMode = 'ordered',
  signature?: ProblemSignature,
  prelude: readonly string[] = []
): { wrappedCode: string; input: string } {
  switch (language) {
    case 'python':
      return wrapPythonFunction(
        joinSources('python', prelude, userCode).source,
        functionName,
        testCases,
        compareMode
      );
    case 'javascript':
      return wrapJavaScriptFunction(
        joinSources('javascript', prelude, userCode).source,
        functionName,
        testCases,
        compareMode
      );
    case 'cpp':
      return wrapCppFunction(
        joinSources('cpp', prelude, userCode).source,
        functionName,
        testCases,
        compareMode,
        signature
      );
    case 'java':
      if (prelude.length > 0) {
        throw new Error('Java does not support a prelude (single-class harness)');
      }
      return wrapJavaFunction(userCode, functionName, testCases, compareMode, signature);
    case 'go':
      return wrapGoFunction(userCode, functionName, testCases, signature, prelude);
    case 'typescript':
      throw new Error('TypeScript must be transpiled to JavaScript before wrapping');
  }
}

/** Marker as written in Python / JavaScript source (\x takes exactly 2 hex digits there). */
const MARK_ESCAPED = '\\x1eCMR:';
/** Marker as written in C++ / Java source (octal: C++'s \x is greedy and would eat "C"). */
const MARK_OCTAL = '\\036CMR:';
// Keep the source spellings and the protocol constant in lock-step.
if (
  MARK_ESCAPED.replace('\\x1e', '\x1e') !== HARNESS_MARK ||
  MARK_OCTAL.replace('\\036', '\x1e') !== HARNESS_MARK
) {
  throw new Error('harness marker out of sync with harnessProtocol.HARNESS_MARK');
}

function wrapPythonFunction(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  compareMode: CompareMode
): { wrappedCode: string; input: string } {
  // The harness times each call with thread_time_ns — CPU time of this thread,
  // which stops ticking while the process is descheduled, so a busy host
  // can't inflate runMs. perf_counter_ns (wall) is kept per test as wallNs
  // for diagnostics. Heap peak comes from tracemalloc. All of these are
  // algorithm-only, unlike the sandbox wall clock (which includes startup).
  //
  // Every harness name is _cm_-prefixed (and the stdlib imports aliased) so
  // the harness can't clobber a learner's own globals such as `results` or
  // a helper called `json`.
  const wrappedCode = `${userCode}

# ---- Codemare auto-generated test harness ----
import json as _cm_json
import sys as _cm_sys
import time as _cm_time
import tracemalloc as _cm_tracemalloc

# 'unordered' compares list results as multisets: both sides are sorted by a
# canonical JSON key before comparing, so [1, 0] == [0, 1].
_CM_COMPARE_MODE = ${JSON.stringify(compareMode)}
_CM_MARK = '${MARK_ESCAPED}'

def _cm_canonical(value):
    if isinstance(value, list):
        return sorted((_cm_canonical(v) for v in value), key=lambda v: _cm_json.dumps(v, sort_keys=True))
    return value

def _cm_outputs_equal(actual, expected):
    if _CM_COMPARE_MODE == 'unordered':
        return _cm_canonical(actual) == _cm_canonical(expected)
    return actual == expected

def _cm_emit(record):
    # allow_nan=False: NaN/Infinity are not JSON; they surface as a test error.
    _cm_sys.stdout.write(_CM_MARK + _cm_json.dumps(record, allow_nan=False) + '\\n')
    _cm_sys.stdout.flush()

_cm_tests = _cm_json.loads(_cm_sys.stdin.read())
_cm_total_run_ns = 0
_cm_peak_bytes = 0

for _cm_i, _cm_test in enumerate(_cm_tests):
    try:
        _cm_tracemalloc.start()
        _cm_w0 = _cm_time.perf_counter_ns()
        _cm_t0 = _cm_time.thread_time_ns()
        _cm_result = ${functionName}(*_cm_test['input'])
        _cm_elapsed = _cm_time.thread_time_ns() - _cm_t0
        _cm_wall = _cm_time.perf_counter_ns() - _cm_w0
        _cm_call_peak = _cm_tracemalloc.get_traced_memory()[1]
        _cm_tracemalloc.stop()
    except Exception as _cm_e:
        try:
            _cm_tracemalloc.stop()
        except Exception:
            pass
        _cm_emit({'i': _cm_i, 'output': None, 'expected': _cm_test['expected'], 'passed': False,
                  'error': f"{type(_cm_e).__name__}: {_cm_e}"})
        continue
    _cm_total_run_ns += _cm_elapsed
    if _cm_call_peak > _cm_peak_bytes:
        _cm_peak_bytes = _cm_call_peak
    try:
        _cm_emit({
            'i': _cm_i,
            'output': _cm_result,
            'expected': _cm_test['expected'],
            'passed': _cm_outputs_equal(_cm_result, _cm_test['expected']),
            'runNs': _cm_elapsed,
            'wallNs': _cm_wall,
            'peakBytes': _cm_call_peak
        })
    except (TypeError, ValueError) as _cm_e:
        _cm_emit({'i': _cm_i, 'output': None, 'expected': _cm_test['expected'], 'passed': False,
                  'error': f"Return value is not JSON-serializable: {type(_cm_e).__name__}: {_cm_e}"})

_cm_emit({'done': True, 'totalRunNs': _cm_total_run_ns, 'peakBytes': _cm_peak_bytes})
`;

  const input = JSON.stringify(
    testCases.map((tc) => ({ input: tc.input, expected: tc.expectedOutput }))
  );

  return { wrappedCode, input };
}

function wrapJavaScriptFunction(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  compareMode: CompareMode
): { wrappedCode: string; input: string } {
  // Times each call with process.cpuUsage() — CPU time (user+system, µs
  // resolution) that doesn't advance while the process is descheduled, so a
  // busy host can't inflate runMs. Node has no per-thread CPU clock, so this
  // is process-wide (V8 helper threads included); hrtime.bigint (wall) is
  // kept per test as wallNs for diagnostics. Per-call peak heap is
  // approximated by reading process.memoryUsage().heapUsed before and
  // after the call. gc() is invoked when --expose-gc is set so the baseline is
  // clean; otherwise the measurement is heap-used at end of call (still a
  // sensible proxy for DSA workloads).
  //
  // Records go out with fs.writeSync: synchronous even when stdout is a pipe,
  // so a record is never lost if the process is killed right after a test.
  // Harness bindings are __cm_-prefixed so a learner's top-level `const
  // results` can't collide with them (a redeclaration is a SyntaxError).
  const wrappedCode = `${userCode}

// ---- Codemare auto-generated test harness ----
const __cm_fs = require('fs');

// 'unordered' compares array results as multisets: both sides are sorted by a
// canonical JSON key before comparing, so [1, 0] == [0, 1].
const __CM_COMPARE_MODE = ${JSON.stringify(compareMode)};
const __CM_MARK = '${MARK_ESCAPED}';

function __cm_canonical(value) {
  if (Array.isArray(value)) {
    return value
      .map(__cm_canonical)
      .sort((x, y) => {
        const kx = JSON.stringify(x);
        const ky = JSON.stringify(y);
        return kx < ky ? -1 : kx > ky ? 1 : 0;
      });
  }
  return value;
}

function __cm_outputsEqual(actual, expected) {
  if (__CM_COMPARE_MODE === 'unordered') {
    return JSON.stringify(__cm_canonical(actual)) === JSON.stringify(__cm_canonical(expected));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function __cm_errorMessage(error) {
  if (error instanceof Error) return error.name + ': ' + error.message;
  try { return 'Uncaught ' + String(error); } catch (_) { return 'Uncaught exception'; }
}

function __cm_emit(record) {
  __cm_fs.writeSync(1, __CM_MARK + JSON.stringify(record) + '\\n');
}

const __cm_tests = JSON.parse(__cm_fs.readFileSync(0, 'utf8'));
let __cm_totalRunNs = 0n;
let __cm_peakBytes = 0;

for (let __cm_i = 0; __cm_i < __cm_tests.length; __cm_i++) {
  const __cm_test = __cm_tests[__cm_i];
  let __cm_result, __cm_elapsed, __cm_wall, __cm_callPeak;
  try {
    if (typeof global.gc === 'function') global.gc();
    const __cm_memBefore = process.memoryUsage().heapUsed;
    const __cm_w0 = process.hrtime.bigint();
    const __cm_c0 = process.cpuUsage();
    __cm_result = ${functionName}(...__cm_test.input);
    const __cm_cpu = process.cpuUsage(__cm_c0);
    __cm_wall = process.hrtime.bigint() - __cm_w0;
    __cm_elapsed = BigInt(Math.round((__cm_cpu.user + __cm_cpu.system) * 1000));
    const __cm_memAfter = process.memoryUsage().heapUsed;
    // Delta of heapUsed approximates allocations made by the function.
    // Negative deltas (GC freed during the call) floor to 0.
    __cm_callPeak = Math.max(__cm_memAfter - __cm_memBefore, 0);
  } catch (__cm_error) {
    __cm_emit({ i: __cm_i, output: null, expected: __cm_test.expected, passed: false, error: __cm_errorMessage(__cm_error) });
    continue;
  }
  __cm_totalRunNs += __cm_elapsed;
  if (__cm_callPeak > __cm_peakBytes) __cm_peakBytes = __cm_callPeak;
  let __cm_line;
  try {
    __cm_line = JSON.stringify({
      i: __cm_i,
      output: __cm_result,
      expected: __cm_test.expected,
      passed: __cm_outputsEqual(__cm_result, __cm_test.expected),
      runNs: Number(__cm_elapsed),
      wallNs: Number(__cm_wall),
      peakBytes: __cm_callPeak
    });
  } catch (__cm_error) {
    __cm_emit({ i: __cm_i, output: null, expected: __cm_test.expected, passed: false, error: 'Return value is not JSON-serializable: ' + __cm_errorMessage(__cm_error) });
    continue;
  }
  __cm_fs.writeSync(1, __CM_MARK + __cm_line + '\\n');
}

__cm_emit({ done: true, totalRunNs: Number(__cm_totalRunNs), peakBytes: __cm_peakBytes });
`;

  const input = JSON.stringify(
    testCases.map((tc) => ({ input: tc.input, expected: tc.expectedOutput }))
  );

  return { wrappedCode, input };
}

/**
 * A problem without a typed `signature` cannot be harnessed for C++/Java
 * (we need concrete types to emit literals and declarations). Emit a minimal
 * program that prints a structured error so the caller gets a clean verdict
 * instead of a parse failure: runService maps a wrapper-declared summary
 * `error` to status XX. (The summary record also carries an empty `results`
 * array from the older single-document harness format.)
 *
 * IDE mode works fully for C++ and Java because it bypasses this wrapper.
 * /v1/run never reaches this: it rejects C++/Java/Go without a signature.
 */
function unsupportedLanguageStub(
  language: 'C++' | 'Java',
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  const msg = `This problem doesn't support ${language} yet (no typed signature). Use IDE mode, or try Python / JavaScript.`;
  const payload = HARNESS_MARK + JSON.stringify({ done: true, results: [], error: msg }) + '\n';
  // JSON.stringify gives a valid C++/Java string literal; its \u001e escape
  // for the marker's RS byte is respelled as octal, valid in both languages.
  const literal = JSON.stringify(payload).replace('\\u001e', '\\036');
  const wrappedCode =
    language === 'C++'
      ? `#include <iostream>
int main() {
    std::cout << ${literal};
    return 0;
}
`
      : `public class Main {
    public static void main(String[] args) {
        System.out.print(${literal});
    }
}
`;
  const input = JSON.stringify(
    testCases.map((tc) => ({ input: tc.input, expected: tc.expectedOutput }))
  );
  return { wrappedCode, input };
}

/* ------------------------------------------------------------------------- *
 * Typed-signature helpers (shared by the C++ and Java generators)
 * ------------------------------------------------------------------------- */

const SIGNATURE_BASE_TYPES: SignatureBaseType[] = [
  'int',
  'long',
  'double',
  'bool',
  'string',
  'char',
];

interface ParsedType {
  base: SignatureBaseType;
  dims: 0 | 1 | 2;
}

export function parseSignatureType(type: SignatureType): ParsedType {
  let base = type as string;
  let dims: 0 | 1 | 2 = 0;
  if (base.endsWith('[][]')) {
    base = base.slice(0, -4);
    dims = 2;
  } else if (base.endsWith('[]')) {
    base = base.slice(0, -2);
    dims = 1;
  }
  if (!SIGNATURE_BASE_TYPES.includes(base as SignatureBaseType)) {
    throw new Error(`Unsupported signature type: ${type}`);
  }
  return { base: base as SignatureBaseType, dims };
}

function requireArrayValue(value: unknown, type: string): any[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Test data does not match signature: expected an array for type ${type}, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

function checkTestArity(testCases: TestCase[], signature: ProblemSignature): void {
  testCases.forEach((tc, i) => {
    if (!Array.isArray(tc.input) || tc.input.length !== signature.params.length) {
      throw new Error(
        `Test ${i + 1} has ${Array.isArray(tc.input) ? tc.input.length : 'no'} input value(s) but the signature declares ${signature.params.length} parameter(s)`
      );
    }
  });
}

/** Integer-notation doubles get an explicit fraction ("5" -> "5.0") so the
 *  literal is typed as a floating literal; exponent forms pass through. */
function doubleLiteral(value: number): string {
  const s = String(value);
  return /^-?\d+$/.test(s) ? `${s}.0` : s;
}

function requireNumber(value: unknown, type: string, integer: boolean): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isSafeInteger(value))
  ) {
    throw new Error(
      `Test data does not match signature: expected ${type}, got ${JSON.stringify(value)}`
    );
  }
  return value;
}

/* ------------------------------------------------------------------------- *
 * C++ generator
 * ------------------------------------------------------------------------- */

const CPP_SCALAR: Record<SignatureBaseType, string> = {
  int: 'int',
  long: 'long long',
  double: 'double',
  bool: 'bool',
  string: 'std::string',
  char: 'char',
};

function cppType(type: SignatureType): string {
  const { base, dims } = parseSignatureType(type);
  const scalar = CPP_SCALAR[base];
  if (dims === 0) return scalar;
  if (dims === 1) return `std::vector<${scalar}>`;
  return `std::vector<std::vector<${scalar}>>`;
}

export function cppStringLiteral(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20) out += '\\' + code.toString(8).padStart(3, '0');
    else out += ch; // non-ASCII passes through as raw UTF-8 in the source
  }
  return out + '"';
}

function cppCharLiteral(s: string): string {
  if (typeof s !== 'string' || s.length !== 1 || s.codePointAt(0)! > 0x7f) {
    throw new Error(
      `Test data does not match signature: expected a single ASCII character for type char, got ${JSON.stringify(s)}`
    );
  }
  const code = s.codePointAt(0)!;
  if (s === "'") return "'\\''";
  if (s === '\\') return "'\\\\'";
  if (s === '\n') return "'\\n'";
  if (s === '\r') return "'\\r'";
  if (s === '\t') return "'\\t'";
  if (code < 0x20) return `'\\${code.toString(8).padStart(3, '0')}'`;
  return `'${s}'`;
}

function cppScalarLiteral(base: SignatureBaseType, value: any): string {
  switch (base) {
    case 'int':
      return String(requireNumber(value, 'int', true));
    case 'long':
      return `${requireNumber(value, 'long', true)}LL`;
    case 'double':
      return doubleLiteral(requireNumber(value, 'double', false));
    case 'bool':
      if (typeof value !== 'boolean') {
        throw new Error(
          `Test data does not match signature: expected bool, got ${JSON.stringify(value)}`
        );
      }
      return value ? 'true' : 'false';
    case 'string':
      if (typeof value !== 'string') {
        throw new Error(
          `Test data does not match signature: expected string, got ${JSON.stringify(value)}`
        );
      }
      return `std::string(${cppStringLiteral(value)})`;
    case 'char':
      return cppCharLiteral(value);
  }
}

export function cppLiteral(type: SignatureType, value: any): string {
  const { base, dims } = parseSignatureType(type);
  if (dims === 0) return cppScalarLiteral(base, value);
  const scalar = CPP_SCALAR[base];
  if (dims === 1) {
    const items = requireArrayValue(value, type).map((v) => cppScalarLiteral(base, v));
    return `std::vector<${scalar}>{${items.join(', ')}}`;
  }
  const rows = requireArrayValue(value, type).map((row) => {
    const items = requireArrayValue(row, `${base}[]`).map((v) => cppScalarLiteral(base, v));
    return `std::vector<${scalar}>{${items.join(', ')}}`;
  });
  return `std::vector<std::vector<${scalar}>>{${rows.join(', ')}}`;
}

/**
 * Fixed helper block shared by every generated C++ program:
 *   __cm_esc   — JSON string escaping
 *   __cm_ser   — JSON serialisation (overloads per scalar + vector template)
 *   __cm_eq    — comparison; doubles use an absolute tolerance of 1e-6
 *   __cm_canon — 'unordered' canonicalisation: recursively sort arrays by
 *                their serialised JSON key (mirrors the python/js harnesses)
 *
 * static_cast<T> around element access keeps std::vector<bool>'s proxy
 * reference from tripping overload resolution.
 */
const CPP_HELPERS = `// ---- Codemare auto-generated test harness ----
static std::string __cm_esc(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        if (c == '"' || c == '\\\\') { out += '\\\\'; out += (char)c; }
        else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof(b), "\\\\u%04x", (int)c); out += b; }
        else out += (char)c;
    }
    return out;
}
static std::string __cm_ser(bool v) { return v ? "true" : "false"; }
static std::string __cm_ser(char v) { return "\\"" + __cm_esc(std::string(1, v)) + "\\""; }
static std::string __cm_ser(int v) { return std::to_string(v); }
static std::string __cm_ser(long long v) { return std::to_string(v); }
static std::string __cm_ser(double v) {
    if (!std::isfinite(v)) return "null";
    char b[40]; std::snprintf(b, sizeof(b), "%.17g", v);
    return std::string(b);
}
static std::string __cm_ser(const std::string& v) { return "\\"" + __cm_esc(v) + "\\""; }
template <typename T>
static std::string __cm_ser(const std::vector<T>& v) {
    std::string out = "[";
    for (size_t i = 0; i < v.size(); ++i) {
        if (i) out += ",";
        out += __cm_ser(static_cast<T>(v[i]));
    }
    return out + "]";
}
static bool __cm_eq(bool a, bool b) { return a == b; }
static bool __cm_eq(char a, char b) { return a == b; }
static bool __cm_eq(int a, int b) { return a == b; }
static bool __cm_eq(long long a, long long b) { return a == b; }
static bool __cm_eq(double a, double b) { return a == b || std::fabs(a - b) <= 1e-6; }
static bool __cm_eq(const std::string& a, const std::string& b) { return a == b; }
template <typename T>
static bool __cm_eq(const std::vector<T>& a, const std::vector<T>& b) {
    if (a.size() != b.size()) return false;
    for (size_t i = 0; i < a.size(); ++i)
        if (!__cm_eq(static_cast<T>(a[i]), static_cast<T>(b[i]))) return false;
    return true;
}
template <typename T>
static void __cm_canon(T&) {}
template <typename T>
static void __cm_canon(std::vector<T>& v) {
    for (size_t i = 0; i < v.size(); ++i) { T e = static_cast<T>(v[i]); __cm_canon(e); v[i] = e; }
    std::sort(v.begin(), v.end(), [](const T& x, const T& y) {
        return __cm_ser(static_cast<T>(x)) < __cm_ser(static_cast<T>(y));
    });
}
// ---- end harness helpers ----`;

/**
 * Ordered most-derived-first (out_of_range etc. extend logic_error;
 * overflow/underflow extend runtime_error). what() alone is often useless
 * ("vector" for libc++ out_of_range), so each catch labels the error with the
 * exception's type. A failed test stays passed:false — the overall verdict is
 * WA, matching the python/js harnesses' per-test-exception behavior.
 */
const CPP_CATCH_TYPES: Array<[string, string]> = [
  ['std::out_of_range', 'out_of_range'],
  ['std::length_error', 'length_error'],
  ['std::invalid_argument', 'invalid_argument'],
  ['std::domain_error', 'domain_error'],
  ['std::range_error', 'range_error'],
  ['std::overflow_error', 'overflow_error'],
  ['std::underflow_error', 'underflow_error'],
  ['std::logic_error', 'logic_error'],
  ['std::runtime_error', 'runtime_error'],
  ['std::bad_alloc', 'bad_alloc'],
  ['std::exception', 'exception'],
];

function cppCatchChain(index: number): string {
  const labeled = CPP_CATCH_TYPES.map(
    ([type, label]) => `        } catch (const ${type}& __e) {
            __cm_emit("{\\"i\\":${index},\\"output\\":null,\\"expected\\":" + __expJson + ",\\"passed\\":false,\\"error\\":\\"" + __cm_esc(std::string("${label}: ") + __e.what()) + "\\"}");`
  ).join('\n');
  return `${labeled}
        } catch (...) {
            __cm_emit("{\\"i\\":${index},\\"output\\":null,\\"expected\\":" + __expJson + ",\\"passed\\":false,\\"error\\":\\"unknown C++ exception\\"}");
        }`;
}

function wrapCppFunction(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  compareMode: CompareMode,
  signature?: ProblemSignature
): { wrappedCode: string; input: string } {
  if (!signature) return unsupportedLanguageStub('C++', testCases);
  checkTestArity(testCases, signature);

  const retType = cppType(signature.returns);
  const retDims = parseSignatureType(signature.returns).dims;
  const canonLines =
    compareMode === 'unordered' && retDims > 0
      ? '            __cm_canon(__res);\n            __cm_canon(__exp);\n'
      : '';

  const blocks = testCases.map((tc, i) => {
    const decls = signature.params
      .map((p, j) => `        ${cppType(p.type)} __p${j} = ${cppLiteral(p.type, tc.input[j])};`)
      .join('\n');
    const args = signature.params.map((_p, j) => `__p${j}`).join(', ');
    return `    { // test ${i + 1}
${decls}
        ${retType} __exp = ${cppLiteral(signature.returns, tc.expectedOutput)};
        const std::string __expJson = __cm_ser(__exp);
        try {
            auto __w0 = std::chrono::steady_clock::now();
            long long __c0 = __cm_thread_cpu_ns();
            ${retType} __res = ${functionName}(${args});
            long long __ns = __cm_thread_cpu_ns() - __c0;
            long long __wallNs = (long long)std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - __w0).count();
            __totalRunNs += __ns;
            const std::string __outJson = __cm_ser(__res);
${canonLines}            const bool __passed = __cm_eq(__res, __exp);
            __cm_emit("{\\"i\\":${i},\\"output\\":" + __outJson + ",\\"expected\\":" + __expJson + ",\\"passed\\":" + (__passed ? "true" : "false") + ",\\"runNs\\":" + std::to_string(__ns) + ",\\"wallNs\\":" + std::to_string(__wallNs) + ",\\"peakBytes\\":0}");
${cppCatchChain(i)}
    }`;
  });

  // Timing uses CLOCK_THREAD_CPUTIME_ID (this thread's CPU time, ns) around
  // the user-function call only — it doesn't advance while descheduled, so a
  // busy host can't inflate runMs. steady_clock (wall) is kept per test as
  // wallNs for diagnostics. peakBytes is best-effort: whole-process
  // ru_maxrss from getrusage (bytes on macOS, KB->bytes on Linux); per-test
  // peakBytes is reported as 0.
  // The user writes a bare function, so the harness owns the includes. Provide
  // the full standard competitive-programming set explicitly — libstdc++ on
  // Linux does NOT transitively include e.g. <unordered_map> the way libc++
  // on macOS does, and a missing header here is a CE for correct user code.
  // Each test's record is written and flushed as soon as the test finishes
  // (see harnessProtocol.ts). The user code arrives with a `#line 1
  // "solution.cpp"` marker (sourceAssembly.joinSources); the `#line` after it
  // attributes everything that follows to harness.cpp, so compile errors
  // name the learner's own line numbers.
  const wrappedCode = `#include <algorithm>
#include <array>
#include <bitset>
#include <chrono>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <deque>
#include <functional>
#include <limits>
#include <map>
#include <new>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <stdexcept>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>
#if !defined(_WIN32)
#include <sys/resource.h>
#endif

${CPP_HELPERS}

static long long __cm_thread_cpu_ns() {
    struct timespec __ts;
    if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &__ts) != 0) return 0;
    return (long long)__ts.tv_sec * 1000000000LL + (long long)__ts.tv_nsec;
}

static void __cm_emit(const std::string& __record) {
    std::fputs("${MARK_OCTAL}", stdout);
    std::fwrite(__record.data(), 1, __record.size(), stdout);
    std::fputc('\\n', stdout);
    std::fflush(stdout);
}

${userCode}
#line 1 "harness.cpp"

int main() {
    long long __totalRunNs = 0;
${blocks.join('\n')}
    long long __peakBytes = 0;
#if defined(__APPLE__)
    { struct rusage __ru; if (getrusage(RUSAGE_SELF, &__ru) == 0) __peakBytes = (long long)__ru.ru_maxrss; }
#elif !defined(_WIN32)
    { struct rusage __ru; if (getrusage(RUSAGE_SELF, &__ru) == 0) __peakBytes = (long long)__ru.ru_maxrss * 1024LL; }
#endif
    __cm_emit("{\\"done\\":true,\\"totalRunNs\\":" + std::to_string(__totalRunNs) + ",\\"peakBytes\\":" + std::to_string(__peakBytes) + "}");
    return 0;
}
`;

  return { wrappedCode, input: '' };
}

/* ------------------------------------------------------------------------- *
 * Java generator
 * ------------------------------------------------------------------------- */

const JAVA_SCALAR: Record<SignatureBaseType, string> = {
  int: 'int',
  long: 'long',
  double: 'double',
  bool: 'boolean',
  string: 'String',
  char: 'char',
};

function javaType(type: SignatureType): string {
  const { base, dims } = parseSignatureType(type);
  return JAVA_SCALAR[base] + '[]'.repeat(dims);
}

function javaEscapeChar(code: number, ch: string): string {
  if (ch === '\\') return '\\\\';
  if (ch === '\n') return '\\n';
  if (ch === '\r') return '\\r';
  if (ch === '\t') return '\\t';
  if (code < 0x20) return '\\' + code.toString(8).padStart(3, '0');
  // Non-ASCII goes out as \\uXXXX (per UTF-16 unit) so the generated file is
  // charset-independent for javac.
  if (code > 0x7e) return '\\u' + code.toString(16).padStart(4, '0');
  return ch;
}

export function javaStringLiteral(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '"') out += '\\"';
    else out += javaEscapeChar(s.charCodeAt(i), ch);
  }
  return out + '"';
}

function javaCharLiteral(s: string): string {
  if (typeof s !== 'string' || s.length !== 1) {
    throw new Error(
      `Test data does not match signature: expected a single character for type char, got ${JSON.stringify(s)}`
    );
  }
  if (s === "'") return "'\\''";
  return `'${javaEscapeChar(s.charCodeAt(0), s)}'`;
}

function javaScalarLiteral(base: SignatureBaseType, value: any): string {
  switch (base) {
    case 'int':
      return String(requireNumber(value, 'int', true));
    case 'long':
      return `${requireNumber(value, 'long', true)}L`;
    case 'double':
      return doubleLiteral(requireNumber(value, 'double', false));
    case 'bool':
      if (typeof value !== 'boolean') {
        throw new Error(
          `Test data does not match signature: expected bool, got ${JSON.stringify(value)}`
        );
      }
      return value ? 'true' : 'false';
    case 'string':
      if (typeof value !== 'string') {
        throw new Error(
          `Test data does not match signature: expected string, got ${JSON.stringify(value)}`
        );
      }
      return javaStringLiteral(value);
    case 'char':
      return javaCharLiteral(value);
  }
}

export function javaLiteral(type: SignatureType, value: any): string {
  const { base, dims } = parseSignatureType(type);
  if (dims === 0) return javaScalarLiteral(base, value);
  const scalar = JAVA_SCALAR[base];
  if (dims === 1) {
    const items = requireArrayValue(value, type).map((v) => javaScalarLiteral(base, v));
    return `new ${scalar}[]{${items.join(', ')}}`;
  }
  const rows = requireArrayValue(value, type).map((row) => {
    const items = requireArrayValue(row, `${base}[]`).map((v) => javaScalarLiteral(base, v));
    return `{${items.join(', ')}}`;
  });
  return `new ${scalar}[][]{${rows.join(', ')}}`;
}

/* -- Large-literal handling ------------------------------------------------
 * The JVM caps every method at 64KB of bytecode and every string constant at
 * 64KB of (modified) UTF-8. A 10k-element array initializer alone compiles to
 * ~100KB of bytecode, so big test inputs cannot be inlined into one method.
 * Strategy:
 *   · each test case runs in its own generated __testN() method;
 *   · any array literal whose "weight" (scalar count, long strings weighted
 *     by length) exceeds JAVA_INLINE_MAX_WEIGHT is hoisted into a __litN()
 *     builder that assembles the array from ≤JAVA_CHUNK_WEIGHT-sized chunk
 *     methods via __fill (System.arraycopy);
 *   · any string constant longer than JAVA_STRING_CHUNK chars is hoisted into
 *     a StringBuilder-based builder (append() is not constant-folded, so no
 *     single 64KB+ string constant is ever emitted).
 */

/** Max literal weight inlined directly into a test method. ~400 int stores is
 *  ~4KB of bytecode, so even several inline params stay far below 64KB. */
const JAVA_INLINE_MAX_WEIGHT = 400;
/** Weight per chunk method — same reasoning, one chunk method stays ~4KB. */
const JAVA_CHUNK_WEIGHT = 400;
/** Max chars per emitted string constant (UTF-8 can inflate 3x; 16000*3 < 64KB). */
const JAVA_STRING_CHUNK = 16000;

interface JavaLitContext {
  aux: string[];
  counter: number;
}

function javaScalarWeight(base: SignatureBaseType, v: any): number {
  return base === 'string' && typeof v === 'string' ? 1 + Math.floor(v.length / 32) : 1;
}

function chunkByWeight<T>(items: T[], weightOf: (item: T) => number, maxWeight: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let weight = 0;
  for (const item of items) {
    const w = weightOf(item);
    if (current.length > 0 && weight + w > maxWeight) {
      chunks.push(current);
      current = [];
      weight = 0;
    }
    current.push(item);
    weight += w;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function javaHoistString(value: string, ctx: JavaLitContext): string {
  const name = `__lit${ctx.counter++}`;
  const appends: string[] = [];
  for (let i = 0; i < value.length; i += JAVA_STRING_CHUNK) {
    appends.push(
      `        b.append(${javaStringLiteral(value.slice(i, i + JAVA_STRING_CHUNK))});`
    );
  }
  ctx.aux.push(`    static String ${name}() {
        StringBuilder b = new StringBuilder(${value.length});
${appends.join('\n')}
        return b.toString();
    }`);
  return `${name}()`;
}

/**
 * Emit a Java expression for `value` of signature type `type`. Small values
 * are returned as inline literals (same output as javaLiteral); values above
 * the inline threshold are hoisted into builder methods registered on `ctx`.
 */
function javaValueExpr(type: SignatureType, value: any, ctx: JavaLitContext): string {
  const { base, dims } = parseSignatureType(type);
  if (dims === 0) {
    if (base === 'string' && typeof value === 'string' && value.length > JAVA_STRING_CHUNK) {
      return javaHoistString(value, ctx);
    }
    return javaScalarLiteral(base, value);
  }
  const scalar = JAVA_SCALAR[base];
  if (dims === 1) {
    const arr = requireArrayValue(value, type);
    const weight = arr.reduce((acc, v) => acc + javaScalarWeight(base, v), 0);
    if (weight <= JAVA_INLINE_MAX_WEIGHT) return javaLiteral(type, value);
    const name = `__lit${ctx.counter++}`;
    const chunks = chunkByWeight(arr, (v) => javaScalarWeight(base, v), JAVA_CHUNK_WEIGHT);
    const fills = chunks.map((chunk, k) => {
      const chunkName = `${name}_c${k}`;
      const items = chunk.map((v: any) => javaScalarLiteral(base, v));
      ctx.aux.push(
        `    static ${scalar}[] ${chunkName}() { return new ${scalar}[]{${items.join(', ')}}; }`
      );
      return `        o = __fill(a, o, ${chunkName}());`;
    });
    ctx.aux.push(`    static ${scalar}[] ${name}() {
        ${scalar}[] a = new ${scalar}[${arr.length}];
        int o = 0;
${fills.join('\n')}
        return a;
    }`);
    return `${name}()`;
  }
  // dims === 2: chunk by whole rows so each chunk method holds a bounded
  // number of scalars.
  const rows = requireArrayValue(value, type);
  const rowWeight = (row: any): number =>
    requireArrayValue(row, `${base}[]`).reduce(
      (acc: number, v: any) => acc + javaScalarWeight(base, v),
      1
    );
  const weight = rows.reduce((acc: number, row: any) => acc + rowWeight(row), 0);
  if (weight <= JAVA_INLINE_MAX_WEIGHT) return javaLiteral(type, value);
  const name = `__lit${ctx.counter++}`;
  const chunks = chunkByWeight(rows, rowWeight, JAVA_CHUNK_WEIGHT);
  const fills = chunks.map((chunk, k) => {
    const chunkName = `${name}_c${k}`;
    const rowLits = chunk.map(
      (row: any) => `{${row.map((v: any) => javaScalarLiteral(base, v)).join(', ')}}`
    );
    ctx.aux.push(
      `    static ${scalar}[][] ${chunkName}() { return new ${scalar}[][]{${rowLits.join(', ')}}; }`
    );
    return `        o = __fill(a, o, ${chunkName}());`;
  });
  ctx.aux.push(`    static ${scalar}[][] ${name}() {
        ${scalar}[][] a = new ${scalar}[${rows.length}][];
        int o = 0;
${fills.join('\n')}
        return a;
    }`);
  return `${name}()`;
}

/**
 * Helper methods emitted into the generated Main class: esc/ser/eq/canon
 * overloads for every supported scalar plus its 1-D and 2-D array forms.
 * Doubles compare with an absolute tolerance of 1e-6. canon (used for
 * compareMode 'unordered') sorts arrays in place — rows recursively, then the
 * outer array by serialised JSON key — giving multiset equality like the
 * python/js harnesses.
 */
function javaHelperMethods(): string {
  const lines: string[] = [];
  lines.push(
    `    static String esc(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\\\') { b.append('\\\\').append(c); }
            else if (c < 0x20) { b.append(String.format("\\\\u%04x", (int) c)); }
            else b.append(c);
        }
        return b.toString();
    }
    static String ser(boolean v) { return v ? "true" : "false"; }
    static String ser(char v) { return "\\"" + esc(String.valueOf(v)) + "\\""; }
    static String ser(int v) { return String.valueOf(v); }
    static String ser(long v) { return String.valueOf(v); }
    static String ser(double v) { return (Double.isNaN(v) || Double.isInfinite(v)) ? "null" : String.valueOf(v); }
    static String ser(String v) { return v == null ? "null" : "\\"" + esc(v) + "\\""; }
    static boolean eq(boolean a, boolean b) { return a == b; }
    static boolean eq(char a, char b) { return a == b; }
    static boolean eq(int a, int b) { return a == b; }
    static boolean eq(long a, long b) { return a == b; }
    static boolean eq(double a, double b) { return a == b || Math.abs(a - b) <= 1e-6; }
    static boolean eq(String a, String b) { return a == null ? b == null : a.equals(b); }`
  );
  for (const base of SIGNATURE_BASE_TYPES) {
    const t = JAVA_SCALAR[base];
    for (const dims of [1, 2] as const) {
      const arr = t + '[]'.repeat(dims);
      lines.push(
        `    static String ser(${arr} v) {
        if (v == null) return "null";
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(ser(v[i])); }
        return b.append(']').toString();
    }
    static boolean eq(${arr} a, ${arr} b) {
        if (a == null || b == null) return a == b;
        if (a.length != b.length) return false;
        for (int i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
        return true;
    }`
      );
    }
    // canon: 1-D sorts elements (any consistent total order gives multiset
    // equality); 2-D canonicalises rows then sorts rows by JSON key.
    if (base === 'bool') {
      lines.push(
        `    static void canon(boolean[] v) {
        if (v == null) return;
        int f = 0;
        for (boolean x : v) if (!x) f++;
        for (int i = 0; i < v.length; i++) v[i] = i >= f;
    }`
      );
    } else if (base === 'string') {
      lines.push(
        `    static void canon(String[] v) { if (v != null) java.util.Arrays.sort(v, (x, y) -> ser(x).compareTo(ser(y))); }`
      );
    } else {
      lines.push(`    static void canon(${t}[] v) { if (v != null) java.util.Arrays.sort(v); }`);
    }
    lines.push(
      `    static void canon(${t}[][] v) {
        if (v == null) return;
        for (${t}[] r : v) canon(r);
        java.util.Arrays.sort(v, (x, y) -> ser(x).compareTo(ser(y)));
    }`
    );
  }
  return lines.join('\n');
}

function wrapJavaFunction(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  compareMode: CompareMode,
  signature?: ProblemSignature
): { wrappedCode: string; input: string } {
  if (!signature) return unsupportedLanguageStub('Java', testCases);
  checkTestArity(testCases, signature);

  const retType = javaType(signature.returns);
  const retDims = parseSignatureType(signature.returns).dims;
  const canonLines =
    compareMode === 'unordered' && retDims > 0
      ? '            canon(res);\n            canon(exp);\n'
      : '';

  // Every test case gets its own __testN() method and large literals are
  // hoisted into builder methods — see the large-literal comment above
  // javaValueExpr for why (JVM 64KB per-method bytecode limit).
  const ctx: JavaLitContext = { aux: [], counter: 0 };

  const testMethods = testCases.map((tc, i) => {
    const decls = signature.params
      .map(
        (p, j) => `        ${javaType(p.type)} p${j} = ${javaValueExpr(p.type, tc.input[j], ctx)};`
      )
      .join('\n');
    const args = signature.params.map((_p, j) => `p${j}`).join(', ');
    return `    static void __test${i + 1}() {
${decls}
        ${retType} exp = ${javaValueExpr(signature.returns, tc.expectedOutput, ctx)};
        String expJson = ser(exp);
        try {
            long w0 = System.nanoTime();
            long t0 = __cpuNs();
            ${retType} res = Solution.${functionName}(${args});
            long ns = __cpuNs() - t0;
            long wallNs = System.nanoTime() - w0;
            totalRunNs += ns;
            String outJson = ser(res);
${canonLines}            boolean passed = eq(res, exp);
            __emit(new StringBuilder("{\\"i\\":${i},\\"output\\":").append(outJson).append(",\\"expected\\":").append(expJson).append(",\\"passed\\":").append(passed).append(",\\"runNs\\":").append(ns).append(",\\"wallNs\\":").append(wallNs).append(",\\"peakBytes\\":0}").toString());
        } catch (Throwable t) {
            String msg = t.getClass().getSimpleName() + (t.getMessage() == null ? "" : ": " + t.getMessage());
            __emit(new StringBuilder("{\\"i\\":${i},\\"output\\":null,\\"expected\\":").append(expJson).append(",\\"passed\\":false,\\"error\\":\\"").append(esc(msg)).append("\\"}").toString());
        }
    }`;
  });

  // Timing uses ThreadMXBean.getCurrentThreadCpuTime() (this thread's CPU
  // time, ns) around the Solution call only — it doesn't advance while
  // descheduled, so a busy host can't inflate runMs. System.nanoTime (wall)
  // is kept per test as wallNs for diagnostics. Memory is not measured for
  // Java (peakBytes 0) — JVM heap introspection is too noisy per call.
  // Each test's record is printed and flushed as soon as it finishes (see
  // harnessProtocol.ts).
  const wrappedCode = `${userCode}

// ---- Codemare auto-generated test harness ----
public class Main {
    static long totalRunNs = 0L;
    static final java.lang.management.ThreadMXBean __cpu = java.lang.management.ManagementFactory.getThreadMXBean();
    static long __cpuNs() {
        return __cpu.isCurrentThreadCpuTimeSupported() ? __cpu.getCurrentThreadCpuTime() : System.nanoTime();
    }
    static void __emit(String record) {
        System.out.print("${MARK_OCTAL}");
        System.out.print(record);
        System.out.print('\\n');
        System.out.flush();
    }

${javaHelperMethods()}
    static int __fill(Object dst, int o, Object src) {
        int n = java.lang.reflect.Array.getLength(src);
        System.arraycopy(src, 0, dst, o, n);
        return o + n;
    }
${ctx.aux.length > 0 ? ctx.aux.join('\n') + '\n' : ''}${testMethods.join('\n')}

    public static void main(String[] args) {
${testCases.map((_tc, i) => `        __test${i + 1}();`).join('\n')}
        __emit("{\\"done\\":true,\\"totalRunNs\\":" + totalRunNs + ",\\"peakBytes\\":0}");
    }
}
`;

  return { wrappedCode, input: '' };
}

/* ------------------------------------------------------------------------- *
 * Go generator
 * ------------------------------------------------------------------------- */

/** Type mapping from spec §2.1. */
const GO_SCALAR: Record<SignatureBaseType, string> = {
  int: 'int',
  long: 'int64',
  double: 'float64',
  bool: 'bool',
  string: 'string',
  char: 'byte',
};

/** Harness serializer (helper block below) for each scalar type. */
const GO_SER: Record<SignatureBaseType, string> = {
  int: '__cmSerInt',
  long: '__cmSerI64',
  double: '__cmSerF64',
  bool: '__cmSerBool',
  string: '__cmStr',
  char: '__cmSerByte',
};

export function goType(type: SignatureType): string {
  const { base, dims } = parseSignatureType(type);
  return '[]'.repeat(dims) + GO_SCALAR[base];
}

/**
 * Go interpreted string literal. Non-ASCII passes through as UTF-8 except
 * what gc rejects in source: a lone surrogate has no UTF-8 form (→ U+FFFD)
 * and a BOM is only legal as the very first character of a file.
 */
export function goStringLiteral(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
    else if (code >= 0xd800 && code <= 0xdfff) out += '\\uFFFD';
    else if (code === 0xfeff) out += '\\uFEFF';
    else out += ch;
  }
  return out + '"';
}

function goCharLiteral(s: string): string {
  if (typeof s !== 'string' || s.length !== 1 || s.codePointAt(0)! > 0x7f) {
    throw new Error(
      `Test data does not match signature: expected a single ASCII character for type char, got ${JSON.stringify(s)}`
    );
  }
  const code = s.charCodeAt(0);
  if (s === "'") return "'\\''";
  if (s === '\\') return "'\\\\'";
  if (s === '\n') return "'\\n'";
  if (s === '\r') return "'\\r'";
  if (s === '\t') return "'\\t'";
  if (code < 0x20 || code === 0x7f) return `'\\x${code.toString(16).padStart(2, '0')}'`;
  return `'${s}'`;
}

function goScalarLiteral(base: SignatureBaseType, value: any): string {
  switch (base) {
    case 'int':
      return String(requireNumber(value, 'int', true));
    case 'long':
      return String(requireNumber(value, 'long', true));
    case 'double':
      return doubleLiteral(requireNumber(value, 'double', false));
    case 'bool':
      if (typeof value !== 'boolean') {
        throw new Error(
          `Test data does not match signature: expected bool, got ${JSON.stringify(value)}`
        );
      }
      return value ? 'true' : 'false';
    case 'string':
      if (typeof value !== 'string') {
        throw new Error(
          `Test data does not match signature: expected string, got ${JSON.stringify(value)}`
        );
      }
      return goStringLiteral(value);
    case 'char':
      return goCharLiteral(value);
  }
}

/**
 * Go literal for a value of a signature type. Scalars are untyped constants
 * (the declaration supplies the type); arrays are typed composite literals,
 * with inner row types elided as Go allows.
 */
export function goLiteral(type: SignatureType, value: any): string {
  const { base, dims } = parseSignatureType(type);
  if (dims === 0) return goScalarLiteral(base, value);
  const scalar = GO_SCALAR[base];
  if (dims === 1) {
    const items = requireArrayValue(value, type).map((v) => goScalarLiteral(base, v));
    return `[]${scalar}{${items.join(', ')}}`;
  }
  const rows = requireArrayValue(value, type).map((row) => {
    const items = requireArrayValue(row, `${base}[]`).map((v) => goScalarLiteral(base, v));
    return `{${items.join(', ')}}`;
  });
  return `[][]${scalar}{${rows.join(', ')}}`;
}

function goSerExpr(type: SignatureType, variable: string): string {
  const { base, dims } = parseSignatureType(type);
  if (dims === 0) return `${GO_SER[base]}(${variable})`;
  return `__cmSer${dims}(${variable}, ${GO_SER[base]})`;
}

/**
 * The harness imports its packages under __cm aliases so they can never
 * collide with the learner's own imports (a learner's `import "fmt"` and
 * the harness's `__cmfmt "fmt"` coexist — Go allows one path under two
 * names). Every import is referenced by the fixed helper block, so none can
 * trip "imported and not used".
 */
const GO_HARNESS_IMPORTS = `import (
	__cmfmt "fmt"
	__cmmath "math"
	__cmos "os"
	__cmrt "runtime"
	__cmstrconv "strconv"
	__cmsys "syscall"
	__cmtime "time"
)
`;

/**
 * Fixed helper block of every generated Go program.
 *
 * Timing: __cmCpuNs is getrusage(RUSAGE_SELF) user+sys time. Go's standard
 * library has no per-thread CPU clock (RUSAGE_THREAD / CLOCK_THREAD_CPUTIME_ID
 * need golang.org/x/sys, and the harness must build on macOS dev too), so —
 * like the Node harness — this is process-wide: GC workers and sysmon count
 * toward the call. That is also what keeps it honest: work farmed out to
 * goroutines is still on the clock, and with GOMAXPROCS=1 (goRunEnv) those
 * goroutines can't run in parallel anyway. main() pins itself with
 * runtime.LockOSThread() so the calls always run on the main thread. Wall
 * time (time.Now, monotonic) is kept per test as wallNs for diagnostics, and
 * runtime.GC() before each call keeps earlier tests' garbage off the clock.
 *
 * Memory: peakBytes is the bytes allocated during the call (MemStats
 * TotalAlloc delta) — an upper bound on the call's live heap.
 *
 * A panic in the learner's function is recovered and reported as that test's
 * error, like the exceptions the other harnesses catch (verdict WA).
 * Unrecoverable failures (stack overflow, fatal runtime errors) kill the
 * process: RE.
 */
const GO_HELPERS = `const __cmMark = "\\x1eCMR:"
const __cmHex = "0123456789abcdef"

var __cmTotalRunNs int64
var __cmPeakBytes int64

func __cmEmit(record string) {
	__cmos.Stdout.WriteString(__cmMark + record + "\\n")
}

func __cmCpuNs() int64 {
	var ru __cmsys.Rusage
	if __cmsys.Getrusage(__cmsys.RUSAGE_SELF, &ru) != nil {
		return 0
	}
	return ru.Utime.Nano() + ru.Stime.Nano()
}

func __cmStr(s string) string {
	b := make([]byte, 0, len(s)+2)
	b = append(b, '"')
	for _, r := range s {
		switch {
		case r == '"':
			b = append(b, '\\\\', '"')
		case r == '\\\\':
			b = append(b, '\\\\', '\\\\')
		case r < 0x20:
			b = append(b, '\\\\', 'u', '0', '0', __cmHex[r>>4], __cmHex[r&0xf])
		default:
			b = append(b, string(r)...)
		}
	}
	return string(append(b, '"'))
}

func __cmSerInt(v int) string   { return __cmstrconv.Itoa(v) }
func __cmSerI64(v int64) string { return __cmstrconv.FormatInt(v, 10) }
func __cmSerF64(v float64) string {
	if __cmmath.IsNaN(v) || __cmmath.IsInf(v, 0) {
		return "null"
	}
	return __cmstrconv.FormatFloat(v, 'g', -1, 64)
}
func __cmSerBool(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
func __cmSerByte(v byte) string { return __cmStr(string([]byte{v})) }

// A nil slice serialises as [] — idiomatic Go for "empty".
func __cmSer1[T any](v []T, f func(T) string) string {
	b := make([]byte, 0, 2+4*len(v))
	b = append(b, '[')
	for i, x := range v {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, f(x)...)
	}
	return string(append(b, ']'))
}

func __cmSer2[T any](v [][]T, f func(T) string) string {
	b := make([]byte, 0, 2+8*len(v))
	b = append(b, '[')
	for i, row := range v {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, __cmSer1(row, f)...)
	}
	return string(append(b, ']'))
}

func __cmPanicMessage(r any) string {
	switch v := r.(type) {
	case error:
		return "panic: " + v.Error()
	case string:
		return "panic: " + v
	default:
		return "panic: " + __cmfmt.Sprint(v)
	}
}

func __cmProtect(call func()) (msg string, ok bool) {
	defer func() {
		if r := recover(); r != nil {
			msg, ok = __cmPanicMessage(r), false
		}
	}()
	call()
	return "", true
}

func __cmRun(i int, call func(), ser func() string) {
	var m0, m1 __cmrt.MemStats
	__cmrt.GC()
	__cmrt.ReadMemStats(&m0)
	w0 := __cmtime.Now()
	c0 := __cmCpuNs()
	msg, ok := __cmProtect(call)
	cpu := __cmCpuNs() - c0
	wall := __cmtime.Since(w0).Nanoseconds()
	__cmrt.ReadMemStats(&m1)
	head := "{\\"i\\":" + __cmstrconv.Itoa(i)
	if !ok {
		__cmEmit(head + ",\\"output\\":null,\\"error\\":" + __cmStr(msg) + "}")
		return
	}
	alloc := int64(m1.TotalAlloc - m0.TotalAlloc)
	__cmTotalRunNs += cpu
	if alloc > __cmPeakBytes {
		__cmPeakBytes = alloc
	}
	__cmEmit(head + ",\\"output\\":" + ser() +
		",\\"runNs\\":" + __cmstrconv.FormatInt(cpu, 10) +
		",\\"wallNs\\":" + __cmstrconv.FormatInt(wall, 10) +
		",\\"peakBytes\\":" + __cmstrconv.FormatInt(alloc, 10) + "}")
}
`;

/**
 * Go harness. The learner writes bare functions — no package clause needed
 * (any is stripped) — plus whatever imports they use; those are hoisted and
 * merged with the prelude's (sourceAssembly.assembleGo). Test inputs are
 * embedded as typed literals, one __cmTestN function per test. Expected
 * values are NOT embedded: the service compares outputs itself, so they
 * never need to exist inside the sandbox.
 */
function wrapGoFunction(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  signature: ProblemSignature | undefined,
  prelude: readonly string[]
): { wrappedCode: string; input: string } {
  if (!signature) {
    throw new Error('Go requires a typed signature');
  }
  checkTestArity(testCases, signature);

  const retType = goType(signature.returns);
  const tests = testCases.map((tc, i) => {
    const decls = signature.params
      .map((p, j) => `\tvar __p${j} ${goType(p.type)} = ${goLiteral(p.type, tc.input[j])}`)
      .join('\n');
    const args = signature.params.map((_p, j) => `__p${j}`).join(', ');
    return `func __cmTest${i}() {
${decls}${decls ? '\n' : ''}	var __res ${retType}
	__cmRun(${i}, func() { __res = ${functionName}(${args}) }, func() string { return ${goSerExpr(signature.returns, '__res')} })
}`;
  });

  const unit = assembleGo(prelude, userCode);
  const userImports = renderGoImports(unit.imports);
  const wrappedCode = `package main

${GO_HARNESS_IMPORTS}
${userImports}${userImports ? '\n' : ''}${unit.body}
//line harness.go:1:1
// ---- Codemare auto-generated test harness ----
${GO_HELPERS}
${tests.join('\n\n')}

func main() {
	__cmrt.LockOSThread()
${testCases.map((_tc, i) => `\t__cmTest${i}()`).join('\n')}
	__cmEmit("{\\"done\\":true,\\"totalRunNs\\":" + __cmstrconv.FormatInt(__cmTotalRunNs, 10) + ",\\"peakBytes\\":" + __cmstrconv.FormatInt(__cmPeakBytes, 10) + "}")
}
`;

  return { wrappedCode, input: '' };
}
