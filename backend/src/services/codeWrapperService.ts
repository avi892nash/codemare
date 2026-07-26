import { Language } from '../models/ExecutionResult.js';
import {
  CompareMode,
  ProblemSignature,
  SignatureBaseType,
  SignatureType,
  TestCase,
} from '../models/Problem.js';

/**
 * Wrap user's function code with test harness for stdin/stdout execution.
 * `compareMode: 'unordered'` makes the harness compare array results as
 * multisets (both sides sorted by a canonical key) instead of element order.
 *
 * Python/JavaScript harnesses read the test data from stdin (dynamically
 * typed). C++/Java harnesses require `signature` — the generator embeds every
 * test input and expected output as typed literals directly in the generated
 * program, so there is no JSON parsing at runtime.
 */
export function wrapFunctionCode(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  language: Language,
  compareMode: CompareMode = 'ordered',
  signature?: ProblemSignature
): { wrappedCode: string; input: string } {
  switch (language) {
    case 'python':
      return wrapPythonFunction(userCode, functionName, testCases, compareMode);
    case 'javascript':
      return wrapJavaScriptFunction(userCode, functionName, testCases, compareMode);
    case 'cpp':
      return wrapCppFunction(userCode, functionName, testCases, compareMode, signature);
    case 'java':
      return wrapJavaFunction(userCode, functionName, testCases, compareMode, signature);
  }
}

function wrapPythonFunction(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  compareMode: CompareMode
): { wrappedCode: string; input: string } {
  // The harness times each call with perf_counter_ns and tracks heap peak via
  // tracemalloc. Reported runMs / memoryKb are from these per-call numbers
  // (algorithm-only), not from the sandbox wall-clock (which includes
  // interpreter startup).
  const wrappedCode = `${userCode}

# Auto-generated test harness
import json
import sys
import time
import tracemalloc

# 'unordered' compares list results as multisets: both sides are sorted by a
# canonical JSON key before comparing, so [1, 0] == [0, 1].
COMPARE_MODE = ${JSON.stringify(compareMode)}

def _canonical(value):
    if isinstance(value, list):
        return sorted((_canonical(v) for v in value), key=lambda v: json.dumps(v, sort_keys=True))
    return value

def _outputs_equal(actual, expected):
    if COMPARE_MODE == 'unordered':
        return _canonical(actual) == _canonical(expected)
    return actual == expected

test_data = json.loads(sys.stdin.read())
results = []
total_run_ns = 0
peak_bytes = 0

for test in test_data:
    try:
        tracemalloc.start()
        t0 = time.perf_counter_ns()
        result = ${functionName}(*test['input'])
        elapsed = time.perf_counter_ns() - t0
        _, call_peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        total_run_ns += elapsed
        if call_peak > peak_bytes:
            peak_bytes = call_peak
        results.append({
            'output': result,
            'expected': test['expected'],
            'passed': _outputs_equal(result, test['expected']),
            'runNs': elapsed,
            'peakBytes': call_peak
        })
    except Exception as e:
        try:
            tracemalloc.stop()
        except Exception:
            pass
        results.append({
            'output': None,
            'expected': test['expected'],
            'passed': False,
            'error': f"{type(e).__name__}: {str(e)}"
        })

print(json.dumps({
    'results': results,
    'totalRunNs': total_run_ns,
    'peakBytes': peak_bytes
}))
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
  // Times each call with hrtime.bigint (nanosecond resolution) and approximates
  // per-call peak heap by reading process.memoryUsage().heapUsed before and
  // after the call. gc() is invoked when --expose-gc is set so the baseline is
  // clean; otherwise the measurement is heap-used at end of call (still a
  // sensible proxy for DSA workloads).
  const wrappedCode = `${userCode}

// Auto-generated test harness
const __fs = require('fs');

// 'unordered' compares array results as multisets: both sides are sorted by a
// canonical JSON key before comparing, so [1, 0] == [0, 1].
const COMPARE_MODE = ${JSON.stringify(compareMode)};

function __canonical(value) {
  if (Array.isArray(value)) {
    return value
      .map(__canonical)
      .sort((x, y) => {
        const kx = JSON.stringify(x);
        const ky = JSON.stringify(y);
        return kx < ky ? -1 : kx > ky ? 1 : 0;
      });
  }
  return value;
}

function __outputsEqual(actual, expected) {
  if (COMPARE_MODE === 'unordered') {
    return JSON.stringify(__canonical(actual)) === JSON.stringify(__canonical(expected));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const testData = JSON.parse(__fs.readFileSync(0, 'utf8'));
const results = [];
let totalRunNs = 0n;
let peakBytes = 0;

for (const test of testData) {
  try {
    if (typeof global.gc === 'function') global.gc();
    const memBefore = process.memoryUsage().heapUsed;
    const t0 = process.hrtime.bigint();
    const result = ${functionName}(...test.input);
    const elapsed = process.hrtime.bigint() - t0;
    const memAfter = process.memoryUsage().heapUsed;
    // Delta of heapUsed approximates allocations made by the function.
    // Negative deltas (GC freed during the call) floor to 0.
    const callPeak = Math.max(memAfter - memBefore, 0);
    totalRunNs += elapsed;
    if (callPeak > peakBytes) peakBytes = callPeak;
    results.push({
      output: result,
      expected: test.expected,
      passed: __outputsEqual(result, test.expected),
      runNs: Number(elapsed),
      peakBytes: callPeak
    });
  } catch (error) {
    results.push({
      output: null,
      expected: test.expected,
      passed: false,
      error: error.message
    });
  }
}

console.log(JSON.stringify({
  results,
  totalRunNs: Number(totalRunNs),
  peakBytes
}));
`;

  const input = JSON.stringify(
    testCases.map((tc) => ({ input: tc.input, expected: tc.expectedOutput }))
  );

  return { wrappedCode, input };
}

/**
 * A problem without a typed `signature` cannot be harnessed for C++/Java
 * (we need concrete types to emit literals and declarations). Emit a minimal
 * program that prints a structured error so the UI surfaces a clean verdict
 * instead of a JSON-parse failure. executionService maps the wrapper-declared
 * `error` to status XX.
 *
 * IDE mode works fully for C++ and Java because it bypasses this wrapper.
 */
function unsupportedLanguageStub(
  language: 'C++' | 'Java',
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  const msg = `This problem doesn't support ${language} yet (no typed signature). Use IDE mode, or try Python / JavaScript.`;
  const payload = JSON.stringify({ results: [], error: msg });
  const wrappedCode =
    language === 'C++'
      ? `#include <iostream>
int main() {
    std::cout << ${JSON.stringify(payload)};
    return 0;
}
`
      : `public class Main {
    public static void main(String[] args) {
        System.out.print(${JSON.stringify(payload)});
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

function cppCatchChain(): string {
  const labeled = CPP_CATCH_TYPES.map(
    ([type, label]) => `        } catch (const ${type}& __e) {
            __out += "{\\"output\\":null,\\"expected\\":" + __expJson + ",\\"passed\\":false,\\"error\\":\\"" + __cm_esc(std::string("${label}: ") + __e.what()) + "\\"}";`
  ).join('\n');
  return `${labeled}
        } catch (...) {
            __out += "{\\"output\\":null,\\"expected\\":" + __expJson + ",\\"passed\\":false,\\"error\\":\\"unknown C++ exception\\"}";
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
    const comma = i > 0 ? '        __out += ",";\n' : '';
    return `    { // test ${i + 1}
${decls}
        ${retType} __exp = ${cppLiteral(signature.returns, tc.expectedOutput)};
        const std::string __expJson = __cm_ser(__exp);
${comma}        try {
            auto __t0 = std::chrono::steady_clock::now();
            ${retType} __res = ${functionName}(${args});
            long long __ns = (long long)std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - __t0).count();
            __totalRunNs += __ns;
            const std::string __outJson = __cm_ser(__res);
${canonLines}            const bool __passed = __cm_eq(__res, __exp);
            __out += "{\\"output\\":" + __outJson + ",\\"expected\\":" + __expJson + ",\\"passed\\":" + (__passed ? "true" : "false") + ",\\"runNs\\":" + std::to_string(__ns) + ",\\"peakBytes\\":0}";
${cppCatchChain()}
    }`;
  });

  // Timing uses std::chrono::steady_clock (monotonic, ns resolution) around
  // the user-function call only. peakBytes is best-effort: whole-process
  // ru_maxrss from getrusage (bytes on macOS, KB->bytes on Linux); per-test
  // peakBytes is reported as 0.
  // The user writes a bare function, so the harness owns the includes. Provide
  // the full standard competitive-programming set explicitly — libstdc++ on
  // Linux does NOT transitively include e.g. <unordered_map> the way libc++
  // on macOS does, and a missing header here is a CE for correct user code.
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

${userCode}

int main() {
    std::string __out = "{\\"results\\":[";
    long long __totalRunNs = 0;
${blocks.join('\n')}
    long long __peakBytes = 0;
#if defined(__APPLE__)
    { struct rusage __ru; if (getrusage(RUSAGE_SELF, &__ru) == 0) __peakBytes = (long long)__ru.ru_maxrss; }
#elif !defined(_WIN32)
    { struct rusage __ru; if (getrusage(RUSAGE_SELF, &__ru) == 0) __peakBytes = (long long)__ru.ru_maxrss * 1024LL; }
#endif
    __out += "],\\"totalRunNs\\":" + std::to_string(__totalRunNs) + ",\\"peakBytes\\":" + std::to_string(__peakBytes) + "}";
    std::printf("%s\\n", __out.c_str());
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
    const comma = i > 0 ? '        out.append(",");\n' : '';
    return `    static void __test${i + 1}() {
${decls}
        ${retType} exp = ${javaValueExpr(signature.returns, tc.expectedOutput, ctx)};
        String expJson = ser(exp);
${comma}        try {
            long t0 = System.nanoTime();
            ${retType} res = Solution.${functionName}(${args});
            long ns = System.nanoTime() - t0;
            totalRunNs += ns;
            String outJson = ser(res);
${canonLines}            boolean passed = eq(res, exp);
            out.append("{\\"output\\":").append(outJson).append(",\\"expected\\":").append(expJson).append(",\\"passed\\":").append(passed).append(",\\"runNs\\":").append(ns).append(",\\"peakBytes\\":0}");
        } catch (Throwable t) {
            String msg = t.getClass().getSimpleName() + (t.getMessage() == null ? "" : ": " + t.getMessage());
            out.append("{\\"output\\":null,\\"expected\\":").append(expJson).append(",\\"passed\\":false,\\"error\\":\\"").append(esc(msg)).append("\\"}");
        }
    }`;
  });

  // Timing uses System.nanoTime() (monotonic) around the Solution call only.
  // Memory is not measured for Java (peakBytes 0) — JVM heap introspection is
  // too noisy to be meaningful per call.
  const wrappedCode = `${userCode}

// ---- Codemare auto-generated test harness ----
public class Main {
    static StringBuilder out = new StringBuilder("{\\"results\\":[");
    static long totalRunNs = 0L;

${javaHelperMethods()}
    static int __fill(Object dst, int o, Object src) {
        int n = java.lang.reflect.Array.getLength(src);
        System.arraycopy(src, 0, dst, o, n);
        return o + n;
    }
${ctx.aux.length > 0 ? ctx.aux.join('\n') + '\n' : ''}${testMethods.join('\n')}

    public static void main(String[] args) {
${testCases.map((_tc, i) => `        __test${i + 1}();`).join('\n')}
        out.append("],\\"totalRunNs\\":").append(totalRunNs).append(",\\"peakBytes\\":0}");
        System.out.println(out);
    }
}
`;

  return { wrappedCode, input: '' };
}
