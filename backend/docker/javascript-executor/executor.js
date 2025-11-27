#!/usr/bin/env node

async function executeCode(code, stdinInput) {
  const inputLines = stdinInput.split('\n');
  let lineIndex = 0;

  // Provide readline helper
  global.readline = () => {
    return lineIndex < inputLines.length ? inputLines[lineIndex++] : '';
  };

  // Capture stdout
  let output = '';
  const originalLog = console.log;
  console.log = (...args) => {
    output += args.join(' ') + '\n';
  };

  try {
    eval(code);
    return { output, error: null };
  } catch (error) {
    return { output, error: error.message };
  } finally {
    console.log = originalLog;
  }
}

async function main() {
  let inputData = '';

  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  try {
    const data = JSON.parse(inputData);
    const result = await executeCode(data.code, data.input);
    console.error(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({
      output: '',
      error: `Executor error: ${error.message}`
    }));
  }
}

main();
