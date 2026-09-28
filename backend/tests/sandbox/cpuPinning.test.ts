// Run with: npx tsx --test tests/sandbox/cpuPinning.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boxCpuList,
  boxIdRanges,
  describePlan,
  formatCpuList,
  isolateCpusetLines,
  parseCpuList,
  parsePinningMode,
  planCpus,
  readAllowedCpus,
  runBoxCpu,
} from '../../src/services/sandbox/cpuPinning.js';

test('parseCpuList reads the kernel cpu-list syntax', () => {
  assert.deepEqual(parseCpuList('0-3,6,8-9'), [0, 1, 2, 3, 6, 8, 9]);
  assert.deepEqual(parseCpuList('5'), [5]);
  assert.deepEqual(parseCpuList(' 0-1 \n'), [0, 1]);
  assert.deepEqual(parseCpuList('2-4,0-3'), [0, 1, 2, 3, 4], 'overlaps merge, output is sorted');
  for (const bad of ['', 'a', '3-1', '1,,2', '-1', '1-']) {
    assert.throws(() => parseCpuList(bad), `rejects ${JSON.stringify(bad)}`);
  }
});

test('formatCpuList writes ranges (taskset -c / cpuset syntax)', () => {
  assert.equal(formatCpuList([0, 1, 2, 3, 6]), '0-3,6');
  assert.equal(formatCpuList([9, 1, 1, 2]), '1-2,9');
  assert.equal(formatCpuList([5]), '5');
  assert.equal(formatCpuList(parseCpuList('1-7,9,11-12')), '1-7,9,11-12');
});

test('readAllowedCpus takes the Cpus_allowed_list line of /proc/self/status', () => {
  const status = 'Name:\tnode\nCpus_allowed:\t3ff\nCpus_allowed_list:\t0-9\nMems_allowed_list:\t0\n';
  assert.deepEqual(readAllowedCpus(status), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(readAllowedCpus('Cpus_allowed_list:\t2,4-5\n'), [2, 4, 5]);
  assert.equal(readAllowedCpus('Name:\tnode\n'), null);
  assert.equal(readAllowedCpus('Cpus_allowed_list:\t\nMems_allowed_list:\t0\n'), null, 'never reads the next line');
});

test('ISOLATE_CPU_PINNING: round-robin (default) or off, nothing else', () => {
  assert.equal(parsePinningMode(undefined), 'round-robin');
  assert.equal(parsePinningMode(''), 'round-robin');
  assert.equal(parsePinningMode(' Round-Robin '), 'round-robin');
  assert.equal(parsePinningMode('off'), 'off');
  for (const bad of ['on', 'true', '1', 'roundrobin']) {
    assert.throws(() => parsePinningMode(bad), /ISOLATE_CPU_PINNING/);
  }
});

test('fewer than 4 CPUs: boxes use all of them, none reserved', () => {
  for (const n of [1, 2, 3]) {
    const cpus = Array.from({ length: n }, (_, i) => i);
    const plan = planCpus(cpus);
    assert.equal(plan.apiCpu, undefined);
    assert.deepEqual(plan.boxCpus, cpus);
  }
});

test('4+ CPUs: the first is reserved for the API, boxes get the rest', () => {
  assert.deepEqual(planCpus([0, 1, 2, 3]), { cpus: [0, 1, 2, 3], apiCpu: 0, boxCpus: [1, 2, 3] });
  // Non-contiguous affinity (e.g. a cpuset-restricted container).
  assert.deepEqual(planCpus([8, 2, 4, 6]), { cpus: [2, 4, 6, 8], apiCpu: 2, boxCpus: [4, 6, 8] });
  assert.throws(() => planCpus([]));
});

test('run boxes: round-robin by box id over the box CPUs, never the API CPU', () => {
  const plan = planCpus([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(runBoxCpu(plan, 0), 1);
  assert.equal(runBoxCpu(plan, 8), 9);
  assert.equal(runBoxCpu(plan, 9), 1);
  assert.equal(runBoxCpu(plan, 99), 1);
  for (let id = 0; id < 100; id++) assert.notEqual(runBoxCpu(plan, id), 0);
  // The run pool hands out ids from the top (99, 98, …): k concurrent boxes
  // land on k different CPUs while k <= 9.
  const concurrent = Array.from({ length: 9 }, (_, i) => runBoxCpu(plan, 99 - i));
  assert.equal(new Set(concurrent).size, 9);
  assert.throws(() => runBoxCpu(plan, -1));
  assert.throws(() => runBoxCpu(plan, 1.5));
});

test('a run box gets one CPU, a compile box every box CPU', () => {
  const plan = planCpus([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(boxCpuList(plan, 'run', 3), '4');
  assert.equal(boxCpuList(plan, 'compile', 100), '1-7');
  const small = planCpus([0, 1]);
  assert.equal(boxCpuList(small, 'run', 5), '1');
  assert.equal(boxCpuList(small, 'compile', 100), '0-1');
});

test('isolate cpuset lines cover exactly the ids both pools hand out', () => {
  const ids = boxIdRanges(100, 4);
  assert.deepEqual(ids.run, Array.from({ length: 100 }, (_, i) => i));
  assert.deepEqual(ids.compile, [100, 101, 102, 103]);
  const lines = isolateCpusetLines(planCpus([0, 1, 2, 3]), ids.run, ids.compile);
  assert.equal(lines.length, 104);
  assert.equal(lines[0], 'box0.cpus = 1');
  assert.equal(lines[1], 'box1.cpus = 2');
  assert.equal(lines[3], 'box3.cpus = 1');
  assert.equal(lines[100], 'box100.cpus = 1-3');
  assert.equal(lines[103], 'box103.cpus = 1-3');
});

test('describePlan says where boxes run and what is reserved', () => {
  assert.equal(
    describePlan(planCpus([0, 1, 2, 3])),
    'run boxes on CPUs 1-3, one CPU each, CPU 0 reserved for the API'
  );
  assert.match(describePlan(planCpus([0, 1])), /CPUs 0-1, one CPU each \(no CPU reserved/);
});

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/services/sandbox/cpuPinningCli.ts');
function runCli(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('cpuPinningCli: nothing but a comment when pinning is off', () => {
  const r = runCli(['1000'], { ISOLATE_CPU_PINNING: 'off' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^# ISOLATE_CPU_PINNING=off/);
  assert.doesNotMatch(r.stdout, /cpus =/);
});

test('cpuPinningCli: refuses a num_boxes smaller than the ids the service uses', () => {
  const r = runCli(['50'], { ISOLATE_CPU_PINNING: 'round-robin' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /num_boxes=50 is too small/);
  assert.equal(runCli([], {}).status, 2);
});

test('cpuPinningCli: one cpuset line per box id (Linux)', { skip: process.platform !== 'linux' }, () => {
  const r = runCli(['1000'], { ISOLATE_CPU_PINNING: 'round-robin' });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^# CPU plan/);
  assert.match(lines[1], /^box0\.cpus = \d+$/);
});
