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
  const wrappedCode = `${userCode}

# Auto-generated test harness
import json
import sys

test_data = json.loads(sys.stdin.read())
results = []

for test in test_data:
    try:
        result = ${functionName}(*test['input'])
        results.append({
            'output': result,
            'expected': test['expected'],
            'passed': result == test['expected']
        })
    except Exception as e:
        results.append({
            'output': None,
            'expected': test['expected'],
            'passed': False,
            'error': f"{type(e).__name__}: {str(e)}"
        })

print(json.dumps({'results': results}))
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
  const wrappedCode = `${userCode}

// Auto-generated test harness
const testData = JSON.parse(readline());
const results = [];

for (const test of testData) {
  try {
    const result = ${functionName}(...test.input);
    results.push({
      output: result,
      expected: test.expected,
      passed: JSON.stringify(result) === JSON.stringify(test.expected)
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

console.log(JSON.stringify({ results }));
`;

  const input = JSON.stringify(
    testCases.map((tc) => ({ input: tc.input, expected: tc.expectedOutput }))
  );

  return { wrappedCode, input };
}

function wrapCppFunction(
  userCode: string,
  _functionName: string,
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  // C++ wrapper is more complex due to type system
  // For now, create a simple template for common use cases
  const wrappedCode = `#include <iostream>
#include <vector>
#include <string>
#include <sstream>
using namespace std;

${userCode}

int main() {
    // C++ wrapper implementation
    // TODO: Generate appropriate wrapper based on function signature
    return 0;
}
`;

  const input = JSON.stringify(
    testCases.map((tc) => ({ input: tc.input, expected: tc.expectedOutput }))
  );

  return { wrappedCode, input };
}

function wrapJavaFunction(
  userCode: string,
  _functionName: string,
  testCases: TestCase[]
): { wrappedCode: string; input: string } {
  // Java wrapper is more complex due to type system
  // For now, create a simple template for common use cases
  const wrappedCode = `import java.util.*;

${userCode}

public class Solution {
    public static void main(String[] args) {
        // Java wrapper implementation
        // TODO: Generate appropriate wrapper based on function signature
    }
}
`;

  const input = JSON.stringify(
    testCases.map((tc) => ({ input: tc.input, expected: tc.expectedOutput }))
  );

  return { wrappedCode, input };
}
