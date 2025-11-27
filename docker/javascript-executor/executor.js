#!/usr/bin/env node

import { createContext, runInContext } from 'vm';

/**
 * Execute user code and run all test cases
 */
function runTests(code, testCases, functionName) {
  const results = [];

  // Create a sandboxed context
  const sandbox = {
    console: {
      log: () => {}, // Disable console.log in user code
      error: () => {},
      warn: () => {},
    },
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    process: undefined,
    require: undefined,
    global: undefined,
    Buffer: undefined,
  };

  const context = createContext(sandbox);

  try {
    // Execute user code in sandbox
    runInContext(code, context, {
      timeout: 5000, // 5 second timeout per execution
      displayErrors: true,
    });

    // Get the user's function
    const userFunction = sandbox[functionName];

    if (!userFunction) {
      return {
        error: `Function '${functionName}' not found in your code`,
      };
    }

    if (typeof userFunction !== 'function') {
      return {
        error: `'${functionName}' is not a function`,
      };
    }

    // Run each test case
    for (const test of testCases) {
      const startTime = performance.now();
      try {
        const result = userFunction(...test.input);
        const executionTime = performance.now() - startTime;

        // Deep equality check for objects/arrays
        const passed = JSON.stringify(result) === JSON.stringify(test.expected);

        results.push({
          output: result,
          expected: test.expected,
          passed,
          executionTime,
        });
      } catch (error) {
        const executionTime = performance.now() - startTime;
        results.push({
          output: null,
          expected: test.expected,
          passed: false,
          error: `${error.name}: ${error.message}`,
          executionTime,
        });
      }
    }

    return { results };
  } catch (error) {
    return {
      error: `${error.name}: ${error.message}`,
      traceback: error.stack,
    };
  }
}

// Main execution
(async () => {
  try {
    let inputData = '';

    // Read from stdin
    for await (const chunk of process.stdin) {
      inputData += chunk;
    }

    const data = JSON.parse(inputData);

    // Run tests
    const output = runTests(
      data.code,
      data.tests,
      data.functionName
    );

    // Output results as JSON
    console.log(JSON.stringify(output));
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.log(JSON.stringify({
        error: `Invalid JSON input: ${error.message}`,
      }));
    } else {
      console.log(JSON.stringify({
        error: `Unexpected error: ${error.message}`,
        traceback: error.stack,
      }));
    }
  }
})();
