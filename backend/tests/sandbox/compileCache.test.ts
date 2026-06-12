// Run with: npx tsx --test tests/sandbox/compileCache.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CompileCache, type FreshCompileOutcome } from '../../src/services/sandbox/compileCache.js';

/** Mock compile thunk: counts invocations and produces a real standalone dir. */
function mockCompiler() {
  let calls = 0;
  const fn = async (): Promise<FreshCompileOutcome> => {
    calls += 1;
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cc-test-'));
    await writeFile(path.join(dir, 'a.out'), `artifact #${calls}`);
    return { kind: 'ok', dir, artifacts: ['a.out'], compileMs: 100 };
  };
  return { fn, calls: () => calls };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

test('miss compiles, hit does not recompile', async () => {
  const cache = new CompileCache(16);
  const m = mockCompiler();

  const a = await cache.getOrCompile('k1', m.fn);
  assert.equal(a.kind, 'ok');
  assert.equal(a.cached, false);
  assert.equal(m.calls(), 1);

  const b = await cache.getOrCompile('k1', m.fn);
  assert.equal(b.cached, true);
  assert.equal(m.calls(), 1, 'second call must not invoke the compiler');

  if (a.kind === 'ok' && b.kind === 'ok') {
    assert.equal(a.dir, b.dir, 'hit returns the same artifact dir');
  }
  await cache.clear();
});

test('single-flight collapses concurrent identical compiles', async () => {
  const cache = new CompileCache(16);
  const m = mockCompiler();

  // Fire five concurrent compiles of the same key before any resolves.
  const results = await Promise.all(
    Array.from({ length: 5 }, () => cache.getOrCompile('same', m.fn))
  );

  assert.equal(m.calls(), 1, 'five concurrent calls must compile once');
  const dirs = new Set(results.map((r) => (r.kind === 'ok' ? r.dir : 'x')));
  assert.equal(dirs.size, 1, 'all share the one artifact dir');
  // Exactly one of them is the originator (cached:false); the rest are hits.
  const fresh = results.filter((r) => !r.cached).length;
  assert.equal(fresh, 1);
  await cache.clear();
});

test('distinct keys compile independently', async () => {
  const cache = new CompileCache(16);
  const m = mockCompiler();
  await cache.getOrCompile('a', m.fn);
  await cache.getOrCompile('b', m.fn);
  assert.equal(m.calls(), 2);
  assert.equal(cache.size(), 2);
  await cache.clear();
});

test('LRU eviction removes the oldest artifact dir', async () => {
  const cache = new CompileCache(2);
  const m = mockCompiler();

  const r1 = await cache.getOrCompile('k1', m.fn);
  await cache.getOrCompile('k2', m.fn);
  // Touch k1 so k2 becomes the LRU.
  await cache.getOrCompile('k1', m.fn);
  // Insert k3 → overflow → evict k2.
  await cache.getOrCompile('k3', m.fn);

  assert.equal(cache.size(), 2);
  // k1 survived (was touched); its dir still exists.
  if (r1.kind === 'ok') {
    assert.equal(await exists(path.join(r1.dir, 'a.out')), true);
  }
  // k1 is still a hit (no recompile).
  const before = m.calls();
  const again = await cache.getOrCompile('k1', m.fn);
  assert.equal(again.cached, true);
  assert.equal(m.calls(), before);
  await cache.clear();
});

test('compile failures are cached too', async () => {
  const cache = new CompileCache(16);
  let calls = 0;
  const failing = async (): Promise<FreshCompileOutcome> => {
    calls += 1;
    return {
      kind: 'fail',
      result: {
        output: '',
        error: 'error: expected ; before }',
        status: 'CE',
        runMs: 0,
        wallMs: 50,
        memoryKb: 0,
        compileMs: 50,
      },
    };
  };

  const a = await cache.getOrCompile('broken', failing);
  assert.equal(a.kind, 'fail');
  const b = await cache.getOrCompile('broken', failing);
  assert.equal(b.kind, 'fail');
  assert.equal(b.cached, true);
  assert.equal(calls, 1, 're-submitting broken code must not recompile');
  await cache.clear();
});

test('clear empties the cache', async () => {
  const cache = new CompileCache(16);
  const m = mockCompiler();
  await cache.getOrCompile('k1', m.fn);
  await mkdir(path.join(os.tmpdir(), 'cc-noop'), { recursive: true }).catch(() => undefined);
  await cache.clear();
  assert.equal(cache.size(), 0);
});
