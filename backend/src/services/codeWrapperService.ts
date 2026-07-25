import { Language } from '../models/ExecutionResult.js';
import { CompareMode, TestCase } from '../models/Problem.js';

/**
 * Wrap user's function code with test harness for stdin/stdout execution.
 * `compareMode: 'unordered'` makes the harness compare array results as
 * multisets (both sides sorted by a canonical key) instead of element order.
 */
export function wrapFunctionCode(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  language: Language,
  compareMode: CompareMode = 'ordered'
): { wrappedCode: string; input: string } {
  switch (language) {
    case 'python':
      return wrapPythonFunction(userCode, functionName, testCases, compareMode);
    case 'javascript':
      return wrapJavaScriptFunction(userCode, functionName, testCases, compareMode);
    case 'cpp':
      return wrapCppFunction(userCode, functionName, testCases);
    case 'java':
      return wrapJavaFunction(userCode, functionName, testCases);
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
 * C++ and Java Problems-mode wrappers are not yet implemented — generating a
 * per-problem harness requires the function signature (templates, references,
 * etc.) which the current problem schema doesn't carry. Until those land, we
 * emit a minimal program that prints a structured error so the UI surfaces a
 * clean verdict instead of a JSON-parse failure.
 *
 * IDE mode works fully for C++ and Java because it bypasses this wrapper.
 */
function unsupportedLanguageStub(
  language: 'C++' | 'Java',
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  const msg = `${language} Problems mode is not yet implemented. Use IDE mode, or try Python / JavaScript.`;
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

function wrapCppFunction(
  _userCode: string,
  _functionName: string,
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  return unsupportedLanguageStub('C++', testCases);
}

function wrapJavaFunction(
  _userCode: string,
  _functionName: string,
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  return unsupportedLanguageStub('Java', testCases);
}
