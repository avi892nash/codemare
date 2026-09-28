// Run with: npx tsx --test tests/run/typescript.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';

process.env.SANDBOX_MODE = 'local';
const { transpileTypeScript } = await import('../../src/services/typescript.js');
const { executeIdeCode } = await import('../../src/services/ideExecutionService.js');
const { validateIdeRequest } = await import('../../src/services/validationService.js');

function evaluate(js: string, expr: string): unknown {
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({ module, exports: module.exports, require: () => ({}) });
  vm.runInContext(`${js}\n;globalThis.__out = (${expr});`, context);
  return (context as { __out?: unknown }).__out;
}

test('types are erased and the output runs as CommonJS', async () => {
  const r = await transpileTypeScript(
    'interface P { x: number }\nexport function twice(p: P): number {\n  const k = 2 as const;\n  return p.x * k;\n}\n'
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(!r.js.includes('interface'));
  assert.ok(r.js.includes('exports.twice'));
  assert.equal(evaluate(r.js, 'twice({ x: 21 })'), 42);
  assert.equal(typeof r.ms, 'number');
});

test('transpile-only: type errors are not compile errors', async () => {
  const r = await transpileTypeScript('const n: number = "not a number";\n');
  assert.ok(r.ok);
});

test('syntax errors come back with file:line:col, the TS code and a code frame', async () => {
  const r = await transpileTypeScript('function f(a: number) {\n  return a +;\n}\n');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /^solution\.ts:2:13 - error TS1109: Expression expected\./);
  assert.ok(r.error.includes('  2 |   return a +;'));
  assert.ok(r.error.includes('^'));
});

test('with a prelude, errors are located in the right piece', async () => {
  const inCode = await transpileTypeScript('function g() {\n  return (;\n}\n', ['function a() { return 1; }\n', 'function b() { return 2; }']);
  assert.equal(inCode.ok, false);
  if (!inCode.ok) assert.match(inCode.error, /^solution\.ts:2:\d+ - error/);

  const inPrelude = await transpileTypeScript('function g() { return 1; }', ['function a() {\n  return 1 +;\n}\n']);
  assert.equal(inPrelude.ok, false);
  if (!inPrelude.ok) assert.match(inPrelude.error, /^prelude_1\.ts:2:\d+ - error/);

  const ok = await transpileTypeScript('function g(): number { return a() + 1; }', ['function a(): number { return 1; }']);
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(evaluate(ok.js, 'g()'), 2);
});

test('IDE mode accepts typescript and go', () => {
  for (const language of ['typescript', 'go']) {
    assert.ok(validateIdeRequest({ language, code: 'x', testCases: [{ input: '', expectedOutput: '' }] }).valid);
  }
});

test('IDE mode: typescript program with stdin', async () => {
  const res = await executeIdeCode({
    language: 'typescript',
    code: 'const input: string = require("fs").readFileSync(0, "utf8");\nconst n: number = Number(input.trim());\nconsole.log(n * 2);\n',
    testCases: [
      { input: '21', expectedOutput: '42' },
      { input: '5', expectedOutput: '11' },
    ],
  });
  assert.equal(res.testResults[0].passed, true);
  assert.equal(res.testResults[0].status, 'OK');
  assert.equal(res.testResults[1].status, 'WA');
  assert.equal(typeof res.testResults[0].compileMs, 'number');
});

test('IDE mode: a typescript syntax error is CE on every case', async () => {
  const res = await executeIdeCode({
    language: 'typescript',
    code: 'const x: number = ;\n',
    testCases: [
      { input: '', expectedOutput: '' },
      { input: '1', expectedOutput: '1' },
    ],
  });
  assert.equal(res.success, false);
  for (const r of res.testResults) {
    assert.equal(r.status, 'CE');
    assert.match(r.error ?? '', /^solution\.ts:1:19 - error TS1109/);
  }
});

test('IDE mode: go program with stdin (compile once, run per case)', async () => {
  const res = await executeIdeCode({
    language: 'go',
    code: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tvar a, b int\n\tfmt.Scan(&a, &b)\n\tfmt.Println(a + b)\n}\n',
    testCases: [
      { input: '1 2', expectedOutput: '3' },
      { input: '40 2', expectedOutput: '42' },
    ],
  });
  assert.deepEqual(res.testResults.map((r) => r.status), ['OK', 'OK']);
  assert.equal(res.totalPassed, 2);

  const ce = await executeIdeCode({
    language: 'go',
    code: 'package main\n\nfunc main() {\n\tundefinedCall()\n}\n',
    testCases: [{ input: '', expectedOutput: '' }],
  });
  assert.equal(ce.testResults[0].status, 'CE');
  assert.match(ce.testResults[0].error ?? '', /undefined: undefinedCall/);
});
