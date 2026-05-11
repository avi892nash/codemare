// Run with: npx tsx --test tests/sandbox/metaParser.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mapMetaToStatus,
  parseIsolateMeta,
} from '../../src/services/sandbox/metaParser.js';

test('parses a successful run', () => {
  const meta = parseIsolateMeta(
    [
      'time:0.012',
      'time-wall:0.034',
      'max-rss:5120',
      'cg-mem:7168',
      'exitcode:0',
      'csw-voluntary:3',
      'csw-forced:0',
    ].join('\n')
  );
  assert.equal(meta.time, 0.012);
  assert.equal(meta.timeWall, 0.034);
  assert.equal(meta.maxRss, 5120);
  assert.equal(meta.cgMem, 7168);
  assert.equal(meta.exitcode, 0);
  assert.equal(mapMetaToStatus(meta), 'OK');
});

test('parses a TLE run', () => {
  const meta = parseIsolateMeta(
    ['time:1.000', 'time-wall:1.020', 'killed:1', 'status:TO', 'message:Time limit exceeded'].join(
      '\n'
    )
  );
  assert.equal(meta.killed, true);
  assert.equal(meta.status, 'TO');
  assert.equal(meta.message, 'Time limit exceeded');
  assert.equal(mapMetaToStatus(meta), 'TLE');
});

test('parses an MLE / OOM run as MLE even when status is TO or SG', () => {
  const meta = parseIsolateMeta(
    [
      'time:0.300',
      'time-wall:0.350',
      'cg-mem:262144',
      'exitsig:9',
      'killed:1',
      'status:SG',
      'cg-oom-killed:1',
    ].join('\n')
  );
  assert.equal(meta.cgOomKilled, true);
  assert.equal(mapMetaToStatus(meta), 'MLE');
});

test('parses a runtime error (nonzero exit, no status)', () => {
  const meta = parseIsolateMeta(['time:0.005', 'time-wall:0.010', 'exitcode:1'].join('\n'));
  assert.equal(mapMetaToStatus(meta), 'RE');
});

test('parses a signal-driven runtime error', () => {
  const meta = parseIsolateMeta(
    ['time:0.005', 'exitsig:11', 'killed:1', 'status:SG'].join('\n')
  );
  assert.equal(mapMetaToStatus(meta), 'RE');
});

test('handles unknown keys without throwing', () => {
  const meta = parseIsolateMeta(
    ['time:0.001', 'made-up-field:42', 'another:totally:fine'].join('\n')
  );
  assert.equal(meta.time, 0.001);
});

test('treats missing status + exit 0 as OK', () => {
  const meta = parseIsolateMeta('exitcode:0\n');
  assert.equal(mapMetaToStatus(meta), 'OK');
});

test('handles CRLF line endings', () => {
  const meta = parseIsolateMeta('time:0.5\r\ntime-wall:0.6\r\nexitcode:0\r\n');
  assert.equal(meta.time, 0.5);
  assert.equal(meta.timeWall, 0.6);
});
