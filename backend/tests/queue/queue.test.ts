// Run with: npx tsx --test tests/queue/queue.test.ts
//
// These cover the queue's behaviour WITHOUT a live Redis — the gating that
// keeps dev and synchronous prod working when REDIS_URL is unset. The
// enqueue/getResult/worker paths against a real Redis are exercised by the
// integration smoke test (tests/queue/integration.sh), which is skipped when
// no REDIS_URL is present.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// Ensure REDIS_URL is unset for this process before importing the module
// (isQueueEnabled is decided from env at import time).
delete process.env.REDIS_URL;

const { isQueueEnabled, enqueue, getResult } = await import('../../src/queue/queue.js');

test('queue is disabled when REDIS_URL is unset', () => {
  assert.equal(isQueueEnabled(), false);
});

test('enqueue throws when the queue is disabled', async () => {
  await assert.rejects(
    () => enqueue({ kind: 'ide', request: { code: 'x', language: 'python', testCases: [] } }),
    /disabled/
  );
});

test('getResult returns not_found when the queue is disabled', async () => {
  const r = await getResult('any-token');
  assert.equal(r.state, 'not_found');
});
