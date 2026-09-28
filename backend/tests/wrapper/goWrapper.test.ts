// Run with: npx tsx --test tests/wrapper/goWrapper.test.ts
//
// Like the javac test in codeWrapper.test.ts, the second half actually runs
// `go build` on generated harnesses (and runs the binaries), so it needs a Go
// toolchain (>= 1.22) on PATH. CI installs one.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  goLiteral,
  goStringLiteral,
  goType,
  wrapFunctionCode,
} from '../../src/services/codeWrapperService.js';
import { parseHarnessOutput } from '../../src/services/harnessProtocol.js';
import { goCompileEnv } from '../../src/services/sandbox/goToolchain.js';
import { ProblemSignature, SignatureType, TestCase } from '../../src/models/Problem.js';

const execFileAsync = promisify(execFile);
const PROBLEMS_DIR = fileURLToPath(new URL('../../src/data/problems', import.meta.url));

const BASES = ['int', 'long', 'double', 'bool', 'string', 'char'] as const;
const ALL_TYPES: SignatureType[] = BASES.flatMap((b) => [b, `${b}[]`, `${b}[][]`] as SignatureType[]);

test('goType maps every signature type (spec §2.1)', () => {
  const expected: Record<string, string> = {
    int: 'int', long: 'int64', double: 'float64', bool: 'bool', string: 'string', char: 'byte',
  };
  for (const base of BASES) {
    assert.equal(goType(base), expected[base]);
    assert.equal(goType(`${base}[]` as SignatureType), `[]${expected[base]}`);
    assert.equal(goType(`${base}[][]` as SignatureType), `[][]${expected[base]}`);
  }
});

test('goLiteral emits typed literals for every signature type', () => {
  assert.equal(goLiteral('int', -7), '-7');
  assert.equal(goLiteral('long', 9007199254740991), '9007199254740991');
  assert.equal(goLiteral('double', 5), '5.0');
  assert.equal(goLiteral('double', 1e-7), '1e-7');
  assert.equal(goLiteral('bool', true), 'true');
  assert.equal(goLiteral('string', 'hi'), '"hi"');
  assert.equal(goLiteral('char', 'x'), "'x'");
  assert.equal(goLiteral('int[]', [2, 7, 11]), '[]int{2, 7, 11}');
  assert.equal(goLiteral('int[]', []), '[]int{}');
  assert.equal(goLiteral('long[]', [1, 2]), '[]int64{1, 2}');
  assert.equal(goLiteral('double[]', [1.5, 2]), '[]float64{1.5, 2.0}');
  assert.equal(goLiteral('bool[]', [true, false]), '[]bool{true, false}');
  assert.equal(goLiteral('string[]', ['a', 'b']), '[]string{"a", "b"}');
  assert.equal(goLiteral('char[]', ['h', 'i']), "[]byte{'h', 'i'}");
  assert.equal(goLiteral('int[][]', [[1, 2], []]), '[][]int{{1, 2}, {}}');
  assert.equal(goLiteral('string[][]', [['x']]), '[][]string{{"x"}}');
  assert.equal(goLiteral('char[][]', [["'"]]), "[][]byte{{'\\''}}");
});

test('goStringLiteral and char literals escape what Go needs', () => {
  assert.equal(goStringLiteral('say "hi"\\'), '"say \\"hi\\"\\\\"');
  assert.equal(goStringLiteral('a\nb\tc\r'), '"a\\nb\\tc\\r"');
  assert.equal(goStringLiteral('\u0001\u007f'), '"\\x01\\x7f"');
  assert.equal(goStringLiteral('é😀'), '"é😀"');
  assert.equal(goStringLiteral('﻿'), '"\\uFEFF"'); // gc rejects a raw BOM mid-file
  assert.equal(goStringLiteral('\ud800'), '"\\uFFFD"'); // lone surrogate: no UTF-8 form
  assert.equal(goLiteral('char', '\\'), "'\\\\'");
  assert.equal(goLiteral('char', '\n'), "'\\n'");
  assert.equal(goLiteral('char', '\u0007'), "'\\x07'");
});

test('mismatched test data throws a descriptive error', () => {
  assert.throws(() => goLiteral('int', 'oops'), /does not match signature/);
  assert.throws(() => goLiteral('int', 1.5), /does not match signature/);
  assert.throws(() => goLiteral('int[]', 5), /does not match signature/);
  assert.throws(() => goLiteral('char', 'é'), /single ASCII character/);
  assert.throws(() => goLiteral('bool', 1), /does not match signature/);
});

const twoSumSig: ProblemSignature = {
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
  returns: 'int[]',
};
const twoSumTests: TestCase[] = [
  { input: [[2, 7, 11, 15], 9], expectedOutput: [0, 1], hidden: false },
  { input: [[3, 2, 4], 6], expectedOutput: [1, 2], hidden: false },
];

test('go harness: package main, aliased harness imports, one function per test, no expected values', () => {
  const { wrappedCode, input } = wrapFunctionCode(
    'package main\n\nimport "sort"\n\nfunc twoSum(nums []int, target int) []int { sort.Ints(nums); return nil }\n',
    'twoSum',
    twoSumTests,
    'go',
    'unordered',
    twoSumSig
  );
  assert.equal(input, '');
  assert.ok(wrappedCode.startsWith('package main\n'));
  assert.equal(wrappedCode.match(/^package /gm)?.length, 1, 'the learner package clause is stripped');
  assert.ok(wrappedCode.includes('__cmfmt "fmt"'));
  assert.ok(wrappedCode.includes('//line solution.go:3:8\n"sort"'));
  assert.ok(wrappedCode.includes('//line solution.go:4:1\n'));
  assert.ok(wrappedCode.includes('//line harness.go:1:1\n'));
  assert.ok(wrappedCode.includes('var __p0 []int = []int{2, 7, 11, 15}'));
  assert.ok(wrappedCode.includes('var __p1 int = 9'));
  assert.ok(wrappedCode.includes('__res = twoSum(__p0, __p1)'));
  assert.ok(wrappedCode.includes('func __cmTest0()') && wrappedCode.includes('func __cmTest1()'));
  assert.ok(wrappedCode.includes('__cmrt.LockOSThread()'));
  assert.ok(wrappedCode.includes('__cmsys.Getrusage(__cmsys.RUSAGE_SELF'));
  // Expected outputs never enter the program (the service compares).
  assert.ok(!wrappedCode.includes('{0, 1}') && !wrappedCode.includes('{1, 2}'));
});

test('go harness requires a signature and matching arity', () => {
  assert.throws(() => wrapFunctionCode('func f() int { return 1 }', 'f', twoSumTests, 'go'), /requires a typed signature/);
  assert.throws(
    () => wrapFunctionCode('x', 'f', [{ input: [1], expectedOutput: 1, hidden: false }], 'go', 'ordered', twoSumSig),
    /declares 2 parameter/
  );
});

/* ------------------------------------------------------------------------- *
 * Real toolchain: go build + run
 * ------------------------------------------------------------------------- */

interface BuiltRun {
  outputs: unknown[];
  errors: Array<string | undefined>;
  done: boolean;
  userOutput: string;
}

async function buildAndRun(wrappedCode: string): Promise<BuiltRun> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'codemare-go-test-'));
  try {
    await writeFile(path.join(dir, 'main.go'), wrappedCode);
    const env = { ...process.env, ...goCompileEnv('local') };
    try {
      await execFileAsync('go', ['build', '-o', 'main', 'main.go'], { cwd: dir, env });
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? String(err);
      throw new Error(`go build failed:\n${stderr}\n--- source ---\n${wrappedCode.slice(0, 4000)}`);
    }
    const { stdout } = await execFileAsync(path.join(dir, 'main'), [], {
      cwd: dir,
      env: { ...process.env, GOMAXPROCS: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    const parsed = parseHarnessOutput(stdout);
    const n = parsed.tests.size;
    return {
      outputs: Array.from({ length: n }, (_, i) => parsed.tests.get(i)?.output),
      errors: Array.from({ length: n }, (_, i) => parsed.tests.get(i)?.error),
      done: parsed.summary !== undefined,
      userOutput: parsed.userOutput,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Values per base type that stress literal escaping and serialization. */
const SAMPLES: Record<(typeof BASES)[number], unknown[]> = {
  int: [0, -2147483648, 2147483647, 42],
  long: [9007199254740991, -9007199254740991, 0],
  double: [0.1, -2.5, 1e-7, 1e21, 3],
  bool: [true, false],
  string: ['', 'plain', 'q"uote\\back\nslash\ttab', 'é, 😀, 中文', '\u0001ctrl'],
  char: ['a', "'", '\\', '"', '\n', ' '],
};

function sampleFor(type: SignatureType): unknown {
  const base = type.replace(/\[\]/g, '') as (typeof BASES)[number];
  const dims = (type.match(/\[\]/g) ?? []).length;
  const values = SAMPLES[base];
  if (dims === 0) return values[values.length - 1];
  if (dims === 1) return values;
  return [values, [], values.slice(0, 1)];
}

function approxEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => approxEqual(x, b[i]));
  return a === b;
}

test('go build + run: every signature type round-trips through literal and serializer', async () => {
  const programs = ALL_TYPES.map((type) => {
    const value = sampleFor(type);
    const sig: ProblemSignature = { params: [{ name: 'x', type }], returns: type };
    const code = `func echo(x ${goType(type)}) ${goType(type)} { return x }\n`;
    const { wrappedCode } = wrapFunctionCode(
      code,
      'echo',
      [{ input: [value], expectedOutput: value, hidden: false }],
      'go',
      'ordered',
      sig
    );
    return { type, value, wrappedCode };
  });
  // First build alone warms the build cache; then the rest in small batches.
  const results: BuiltRun[] = [await buildAndRun(programs[0].wrappedCode)];
  for (let k = 1; k < programs.length; k += 4) {
    results.push(...(await Promise.all(programs.slice(k, k + 4).map((p) => buildAndRun(p.wrappedCode)))));
  }
  programs.forEach((p, k) => {
    const r = results[k];
    assert.ok(r.done, `${p.type}: harness finished`);
    assert.equal(r.errors[0], undefined, `${p.type}: no error`);
    assert.ok(
      approxEqual(r.outputs[0], p.value),
      `${p.type}: got ${JSON.stringify(r.outputs[0])}, want ${JSON.stringify(p.value)}`
    );
  });
});

test('go build + run: two-sum with a prelude, merged imports and a learner fmt import', async () => {
  const prelude = [
    'package main\n\nimport "sort"\n\n// index of x in a sorted copy — unused by the answer, exercises the prelude\nfunc sortedIndex(a []int, x int) int {\n\tb := append([]int(nil), a...)\n\tsort.Ints(b)\n\treturn sort.SearchInts(b, x)\n}\n',
  ];
  const code = `package main

import (
\t"fmt"
\t"sort"
)

func twoSum(nums []int, target int) []int {
\tfmt.Print("") // learner debug output must not break result parsing
\t_ = sort.IsSorted
\t_ = sortedIndex(nums, target)
\tseen := map[int]int{}
\tfor i, n := range nums {
\t\tif j, ok := seen[target-n]; ok {
\t\t\treturn []int{j, i}
\t\t}
\t\tseen[n] = i
\t}
\tfmt.Println("not found")
\treturn nil
}
`;
  const { wrappedCode } = wrapFunctionCode(
    code,
    'twoSum',
    [...twoSumTests, { input: [[1, 2], 99], expectedOutput: [], hidden: true }],
    'go',
    'unordered',
    twoSumSig,
    prelude
  );
  const r = await buildAndRun(wrappedCode);
  assert.ok(r.done);
  assert.deepEqual(r.outputs, [[0, 1], [1, 2], []]); // nil slice → []
  assert.equal(r.userOutput, 'not found\n');
});

test('go build + run: a panic is a per-test error and later tests still run', async () => {
  const sig: ProblemSignature = { params: [{ name: 'a', type: 'int[]' }, { name: 'i', type: 'int' }], returns: 'int' };
  const { wrappedCode } = wrapFunctionCode(
    'func at(a []int, i int) int { return a[i] }\n',
    'at',
    [
      { input: [[1, 2, 3], 1], expectedOutput: 2, hidden: false },
      { input: [[1, 2, 3], 5], expectedOutput: 0, hidden: false },
      { input: [[4], 0], expectedOutput: 4, hidden: false },
    ],
    'go',
    'ordered',
    sig
  );
  const r = await buildAndRun(wrappedCode);
  assert.ok(r.done);
  assert.deepEqual(r.outputs, [2, null, 4]);
  assert.match(r.errors[1] ?? '', /^panic: runtime error: index out of range \[5\] with length 3/);
});

test('go build + run: the 10k-element catalog literal compiles and runs', async () => {
  const problem = JSON.parse(await readFile(path.join(PROBLEMS_DIR, 'binary-search.json'), 'utf8'));
  const code = `func ${problem.functionName}(nums []int, target int) int {
\tlo, hi := 0, len(nums)-1
\tfor lo <= hi {
\t\tm := lo + (hi-lo)/2
\t\tswitch {
\t\tcase nums[m] == target:
\t\t\treturn m
\t\tcase nums[m] < target:
\t\t\tlo = m + 1
\t\tdefault:
\t\t\thi = m - 1
\t\t}
\t}
\treturn -1
}
`;
  const { wrappedCode } = wrapFunctionCode(
    code,
    problem.functionName,
    problem.testCases,
    'go',
    problem.compareMode ?? 'ordered',
    problem.signature
  );
  const r = await buildAndRun(wrappedCode);
  assert.ok(r.done);
  assert.deepEqual(r.outputs, problem.testCases.map((tc: TestCase) => tc.expectedOutput));
});
