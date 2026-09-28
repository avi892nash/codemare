// Run with: npx tsx --test tests/run/harnessProtocol.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  HARNESS_MARK,
  HarnessStreamParser,
  parseHarnessOutput,
} from '../../src/services/harnessProtocol.js';

const rec = (obj: unknown): string => `${HARNESS_MARK}${JSON.stringify(obj)}\n`;

test('parses test records and the summary, keeping user output apart', () => {
  const stdout =
    'debug: starting\n' +
    rec({ i: 0, output: [0, 1], runNs: 1500, wallNs: 2000, peakBytes: 64 }) +
    'user print between tests\n' +
    rec({ i: 1, error: 'ZeroDivisionError: division by zero' }) +
    rec({ done: true, totalRunNs: 1500, peakBytes: 64 });
  const parsed = parseHarnessOutput(stdout);
  assert.equal(parsed.tests.size, 2);
  assert.deepEqual(parsed.tests.get(0)?.output, [0, 1]);
  assert.equal(parsed.tests.get(0)?.runNs, 1500);
  assert.equal(parsed.tests.get(1)?.error, 'ZeroDivisionError: division by zero');
  assert.deepEqual(parsed.summary, { totalRunNs: 1500, peakBytes: 64, error: undefined });
  assert.equal(parsed.userOutput, 'debug: starting\nuser print between tests\n');
});

test('a record glued to user output without a newline is still found', () => {
  const parsed = parseHarnessOutput(`no newline here${rec({ i: 0, output: 5 })}`);
  assert.equal(parsed.tests.get(0)?.output, 5);
  assert.equal(parsed.userOutput, 'no newline here');
});

test('first record per index wins; malformed and out-of-range records are ignored', () => {
  const stdout =
    rec({ i: 0, output: 'first' }) +
    rec({ i: 0, output: 'second' }) +
    `${HARNESS_MARK}{not json}\n` +
    rec({ i: -1, output: 'negative' }) +
    rec({ i: 1.5, output: 'fraction' }) +
    rec([1, 2, 3]);
  const parsed = parseHarnessOutput(stdout);
  assert.equal(parsed.tests.size, 1);
  assert.equal(parsed.tests.get(0)?.output, 'first');
  assert.equal(parsed.summary, undefined);
});

test('a killed run yields the completed records and no summary', () => {
  // The process died while writing test 2's record.
  const stdout = rec({ i: 0, output: 1 }) + rec({ i: 1, output: 2 }) + `${HARNESS_MARK}{"i":2,"out`;
  const parsed = parseHarnessOutput(stdout);
  assert.deepEqual([...parsed.tests.keys()], [0, 1]);
  assert.equal(parsed.summary, undefined);
});

test('invalid numeric fields are dropped rather than trusted', () => {
  const parsed = parseHarnessOutput(rec({ i: 0, output: 1, runNs: -5, wallNs: 'x', peakBytes: 12 }));
  const r = parsed.tests.get(0)!;
  assert.equal(r.runNs, undefined);
  assert.equal(r.wallNs, undefined);
  assert.equal(r.peakBytes, 12);
});

test('stream parser handles records split across arbitrary chunk boundaries', () => {
  const full =
    'noise' + rec({ i: 0, output: 'a' }) + rec({ i: 1, output: 'ü' }) + rec({ done: true });
  // Split at every possible single point, including inside the marker.
  for (let cut = 0; cut <= full.length; cut++) {
    const parser = new HarnessStreamParser();
    const seen = [...parser.push(full.slice(0, cut)), ...parser.push(full.slice(cut))];
    assert.deepEqual(
      seen.map((r) => [r.i, r.output]),
      [
        [0, 'a'],
        [1, 'ü'],
      ],
      `cut at ${cut}`
    );
  }
});

test('stream parser emits each index once, like the final parse', () => {
  const parser = new HarnessStreamParser();
  const first = parser.push(rec({ i: 0, output: 1 }));
  const again = parser.push(rec({ i: 0, output: 2 }));
  assert.equal(first.length, 1);
  assert.equal(again.length, 0);
});
