// Run with: npx tsx --test tests/sandbox/boxPool.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { BoxPool } from '../../src/services/sandbox/boxPool.js';

test('acquire returns distinct ids until pool is exhausted', async () => {
  const pool = new BoxPool(3);
  const a = await pool.acquire();
  const b = await pool.acquire();
  const c = await pool.acquire();
  assert.equal(new Set([a, b, c]).size, 3);
  pool.release(a);
  pool.release(b);
  pool.release(c);
});

test('acquire blocks when pool is empty and resumes on release', async () => {
  const pool = new BoxPool(1);
  const first = await pool.acquire();

  let resolved = false;
  const second = pool.acquire().then((id) => {
    resolved = true;
    return id;
  });

  // Tick once; second should still be pending.
  await new Promise((r) => setImmediate(r));
  assert.equal(resolved, false);

  pool.release(first);
  const id = await second;
  assert.equal(id, first); // released id is handed directly to the waiter
});

test('release with no waiters returns id to free list', async () => {
  const pool = new BoxPool(2);
  const id = await pool.acquire();
  pool.release(id);
  const again = await pool.acquire();
  assert.equal(again, id);
});

test('throws on invalid capacity', () => {
  assert.throws(() => new BoxPool(0));
  assert.throws(() => new BoxPool(-1));
});
