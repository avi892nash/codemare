// Run with: npx tsx --test tests/sandbox/boxOutput.test.ts
//
// Reading what a sandboxed program wrote (bounded, never through a symlink)
// and turning isolate's meta into a verdict — including the output cap.
import { after, before, test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  outputLimitHit,
  outputLimitMessage,
  readBoxFile,
  readBoxFileHeadTail,
  runBoxResult,
  SIGXFSZ,
} from '../../src/services/sandbox/boxOutput.js';
import { parseIsolateMeta } from '../../src/services/sandbox/metaParser.js';

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'codemare-boxout-'));
});
after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('readBoxFile reads at most the budget and reports the real size', async () => {
  const file = path.join(dir, 'stdout.txt');
  await writeFile(file, 'a'.repeat(1000));
  assert.deepEqual(await readBoxFile(file, 4096), { text: 'a'.repeat(1000), size: 1000 });
  assert.deepEqual(await readBoxFile(file, 10), { text: 'a'.repeat(10), size: 1000 });
});

test('readBoxFile: a missing file is empty output', async () => {
  assert.deepEqual(await readBoxFile(path.join(dir, 'nope.txt'), 100), { text: '', size: 0 });
});

test('a symlink planted in the box is never followed', async () => {
  const secret = path.join(dir, 'host-secret.txt');
  await writeFile(secret, 'INTERNAL_TOKEN=do-not-leak');
  const link = path.join(dir, 'stdout-link.txt');
  await symlink(secret, link);
  assert.deepEqual(await readBoxFile(link, 1024), { text: '', size: 0 });
  assert.deepEqual(await readBoxFileHeadTail(link, 1024), { text: '', size: 0 });
});

test('only regular files are read (a directory in place of stdout is empty)', async () => {
  const sub = path.join(dir, 'stdout-dir.txt');
  await mkdir(sub);
  assert.deepEqual(await readBoxFile(sub, 1024), { text: '', size: 0 });
});

test('readBoxFileHeadTail keeps both ends of a long stderr', async () => {
  const file = path.join(dir, 'stderr.txt');
  const text = `START\n${'x'.repeat(5000)}\nTraceback: the real error\n`;
  await writeFile(file, text);
  assert.deepEqual(await readBoxFileHeadTail(file, 1 << 20), { text, size: text.length });
  const cut = await readBoxFileHeadTail(file, 200);
  assert.equal(cut.size, text.length);
  assert.ok(cut.text.startsWith('START\n'), 'head kept');
  assert.ok(cut.text.endsWith('Traceback: the real error\n'), 'tail kept');
  assert.match(cut.text, new RegExp(`… \\(${text.length - 200} bytes omitted\\) …`));
  assert.ok(cut.text.length < 300);
});

test('outputLimitHit: SIGXFSZ, or a stream that reached the cap', () => {
  const cap = 1024;
  assert.equal(SIGXFSZ, 25);
  assert.equal(outputLimitHit(parseIsolateMeta(`exitsig:${SIGXFSZ}\nstatus:SG`), 10, 0, cap), true);
  assert.equal(outputLimitHit(parseIsolateMeta('exitcode:0'), cap, 0, cap), true, 'stdout at the cap');
  assert.equal(outputLimitHit(parseIsolateMeta('exitcode:1'), 0, cap, cap), true, 'stderr at the cap');
  assert.equal(outputLimitHit(parseIsolateMeta('exitcode:0'), cap - 1, cap - 1, cap), false);
  assert.equal(outputLimitHit(parseIsolateMeta('exitsig:11\nstatus:SG'), 0, 0, cap), false);
  assert.equal(outputLimitMessage(16 * 1024 * 1024), 'Output limit exceeded (16 MB)');
});

const LIMITS = { timeoutMs: 2000, memoryKb: 256 * 1024, outputCapBytes: 16 * 1024 * 1024 };
const out = (text: string, size = text.length) => ({ text, size });

test('runBoxResult: a clean run', () => {
  const r = runBoxResult({
    meta: parseIsolateMeta('time:0.012\ntime-wall:0.034\ncg-mem:7168\nexitcode:0'),
    stdout: out('42\n'),
    stderr: out(''),
    compileMs: 250,
    ...LIMITS,
  });
  assert.deepEqual(r, { output: '42\n', error: undefined, status: 'OK', runMs: 12, wallMs: 34, memoryKb: 7168, compileMs: 250, exitCode: 0 });
});

test('runBoxResult: TLE, MLE and RE carry clear messages', () => {
  const tle = runBoxResult({ meta: parseIsolateMeta('time:2.1\nstatus:TO\nkilled:1'), stdout: out(''), stderr: out(''), ...LIMITS });
  assert.equal(tle.status, 'TLE');
  assert.equal(tle.error, 'Time limit exceeded (2000 ms)');
  const mle = runBoxResult({ meta: parseIsolateMeta('cg-oom-killed:1\nstatus:SG\nexitsig:9'), stdout: out(''), stderr: out(''), ...LIMITS });
  assert.equal(mle.status, 'MLE');
  assert.equal(mle.error, 'Memory limit exceeded (256 MB)');
  const re = runBoxResult({
    meta: parseIsolateMeta('exitcode:1\nstatus:RE\nmessage:Exited with error status 1'),
    stdout: out('partial\n'),
    stderr: out('  ZeroDivisionError: division by zero\n'),
    ...LIMITS,
  });
  assert.equal(re.status, 'RE');
  assert.equal(re.error, 'ZeroDivisionError: division by zero');
  assert.equal(re.output, 'partial\n');
  const sig = runBoxResult({ meta: parseIsolateMeta('exitsig:11\nstatus:SG\nmessage:Caught fatal signal 11'), stdout: out(''), stderr: out(''), ...LIMITS });
  assert.equal(sig.error, 'Caught fatal signal 11', 'meta message when stderr is empty');
});

test('runBoxResult: hitting the output cap is "Output limit exceeded", whatever isolate says', () => {
  const cap = LIMITS.outputCapBytes;
  const cases = [
    // Java / Go: the write error is swallowed, the loop runs into the time limit.
    'time:2.1\nstatus:TO\nkilled:1',
    // Node: output queued until the cgroup OOM-killed it.
    'cg-oom-killed:1\nexitsig:9\nstatus:SG',
    // Python: OSError EFBIG, exit status 120.
    'exitcode:120\nstatus:RE',
    // Swallowed, then a clean exit: still over.
    'exitcode:0',
  ];
  for (const meta of cases) {
    const r = runBoxResult({ meta: parseIsolateMeta(meta), stdout: out('x'.repeat(100), cap), stderr: out(''), ...LIMITS });
    assert.equal(r.status, 'RE', meta);
    assert.equal(r.error, 'Output limit exceeded (16 MB)', meta);
    assert.equal(r.output.length, 100, 'what was read is still returned');
  }
  // C++: killed by SIGXFSZ before the file is full (a big single write).
  const cpp = runBoxResult({ meta: parseIsolateMeta(`exitsig:${SIGXFSZ}\nstatus:SG`), stdout: out('x'), stderr: out(''), ...LIMITS });
  assert.equal(cpp.error, 'Output limit exceeded (16 MB)');
});
