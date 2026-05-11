import { Language } from '../models/ExecutionResult.js';
import { TestCase } from '../models/Problem.js';

/**
 * Wrap user's function code with test harness for stdin/stdout execution
 */
export function wrapFunctionCode(
  userCode: string,
  functionName: string,
  testCases: TestCase[],
  language: Language
): { wrappedCode: string; input: string } {
  switch (language) {
    case 'python':
      return wrapPythonFunction(userCode, functionName, testCases);
    case 'javascript':
      return wrapJavaScriptFunction(userCode, functionName, testCases);
    case 'cpp':
      return wrapCppFunction(userCode, functionName, testCases);
    case 'java':
      return wrapJavaFunction(userCode, functionName, testCases);
  }
}

function wrapPythonFunction(
  userCode: string,
  functionName: string,
  testCases: TestCase[]
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
            'passed': result == test['expected'],
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
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  // Times each call with hrtime.bigint (nanosecond resolution) and approximates
  // per-call peak heap by reading process.memoryUsage().heapUsed before and
  // after the call. gc() is invoked when --expose-gc is set so the baseline is
  // clean; otherwise the measurement is heap-used at end of call (still a
  // sensible proxy for DSA workloads).
  const wrappedCode = `${userCode}

// Auto-generated test harness
const __fs = require('fs');
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
      passed: JSON.stringify(result) === JSON.stringify(test.expected),
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
