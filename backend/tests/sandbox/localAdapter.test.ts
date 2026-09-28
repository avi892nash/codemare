// Run with: npx tsx --test tests/sandbox/localAdapter.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { executeLocal } from '../../src/services/sandbox/localAdapter.js';
import type { RunPhase } from '../../src/services/sandbox/types.js';

test('phases: compiling only on a real compile, then running', async () => {
  const code = `// ${Date.now()}-${Math.random()}\n#include <cstdio>\nint main() { std::puts("hi"); return 0; }\n`;
  const first: RunPhase[] = [];
  const a = await executeLocal('cpp', code, '', { onPhase: (p) => first.push(p) });
  assert.equal(a.status, 'OK');
  assert.deepEqual(first, ['compiling', 'running']);
  const second: RunPhase[] = [];
  const b = await executeLocal('cpp', code, '', { onPhase: (p) => second.push(p) });
  assert.equal(b.status, 'OK');
  assert.deepEqual(second, ['running'], 'a compile-cache hit is not a compile');
});

test('interpreted languages report only running', async () => {
  const phases: RunPhase[] = [];
  const r = await executeLocal('python', 'print("x")', '', { onPhase: (p) => phases.push(p) });
  assert.equal(r.output, 'x\n');
  assert.deepEqual(phases, ['running']);
});

test('onStdout sees output while the program is still running', async () => {
  const chunks: Array<{ text: string; at: number }> = [];
  const start = Date.now();
  const r = await executeLocal(
    'python',
    'import sys, time\nprint("early", flush=True)\ntime.sleep(0.4)\nprint("late")\n',
    '',
    { onStdout: (text) => chunks.push({ text, at: Date.now() - start }) }
  );
  assert.equal(r.output, 'early\nlate\n');
  const early = chunks.find((c) => c.text.includes('early'));
  assert.ok(early, 'early output was streamed');
  assert.ok(early!.at < Date.now() - start - 250, 'it arrived well before the process ended');
});

test('an abort kills the process and reports a cancelled run', async () => {
  const controller = new AbortController();
  const started = Date.now();
  setTimeout(() => controller.abort(), 300);
  const r = await executeLocal('python', 'while True:\n    pass\n', '', {
    timeoutMs: 10_000,
    signal: controller.signal,
  });
  assert.equal(r.status, 'XX');
  assert.equal(r.error, 'Run cancelled');
  assert.ok(Date.now() - started < 5_000, 'did not wait for the 10 s limit');
});

test('an already-aborted signal never starts the run', async () => {
  const controller = new AbortController();
  controller.abort();
  const phases: RunPhase[] = [];
  const r = await executeLocal('python', 'print(1)', '', { signal: controller.signal, onPhase: (p) => phases.push(p) });
  assert.equal(r.status, 'XX');
  assert.deepEqual(phases, []);
});

test('go runs with GOMAXPROCS=1 and a GOMEMLIMIT under the memory limit', async () => {
  const r = await executeLocal(
    'go',
    'package main\n\nimport (\n\t"fmt"\n\t"os"\n\t"runtime"\n)\n\nfunc main() {\n\tfmt.Println(runtime.GOMAXPROCS(0), os.Getenv("GOMEMLIMIT"))\n}\n',
    '',
    { memoryKb: 256 * 1024 }
  );
  assert.equal(r.status, 'OK', r.error);
  assert.equal(r.output.trim(), '1 235929KiB');
});
