// Run with: npx tsx --test tests/sandbox/isolateCommand.test.ts
//
// The exact isolate command line for every language and phase: limits,
// syscall filter, core dumps, file-size cap, environment and CPU pinning.
// These are what the production sandbox enforces, so they are pinned here.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { SANDBOX_CONFIG } from '../../src/config/sandbox.js';
import { CpuPlan, planCpus } from '../../src/services/sandbox/cpuPinning.js';
import { goCompileDirs } from '../../src/services/sandbox/goToolchain.js';
import {
  BOX_BASE_ENV,
  BoxSpec,
  compileBoxSpec,
  isolateCommand,
  isolateRunArgs,
  resolveRunLimits,
  runBoxSpec,
  SYSCALL_FILE_LOCKS,
  SYSCALLS_STRICT,
} from '../../src/services/sandbox/isolateCommand.js';
import { getLanguageSpec } from '../../src/services/sandbox/languageSpec.js';
import { SandboxLanguage } from '../../src/models/ExecutionResult.js';

const FILES = { metaPath: '/tmp/isolate-7.meta', stdoutFile: 'stdout-7.txt', stderrFile: 'stderr-7.txt' };
const LANGS: SandboxLanguage[] = ['python', 'javascript', 'cpp', 'java', 'go'];
const COMPILED: SandboxLanguage[] = ['cpp', 'java', 'go'];
const PLAN = planCpus([0, 1, 2, 3, 4, 5, 6, 7]); // CPU 0 for the API, boxes on 1-7

function mainFile(lang: SandboxLanguage): string {
  return getLanguageSpec(lang).mainFileName('public class Main { }');
}

function runBox(lang: SandboxLanguage, boxId = 7, plan: CpuPlan | null = PLAN): BoxSpec {
  const spec = getLanguageSpec(lang);
  return runBoxSpec(spec, mainFile(lang), resolveRunLimits(spec), plan, boxId);
}

function compileBox(lang: SandboxLanguage, boxId = 100, plan: CpuPlan | null = PLAN): BoxSpec {
  return compileBoxSpec(getLanguageSpec(lang), mainFile(lang), plan, boxId);
}

/** --name=value flags of an isolate argv, as a map (repeated --env/--dir as arrays). */
function flags(args: string[]): { single: Map<string, string>; env: string[]; dirs: string[]; argv: string[] } {
  const sep = args.indexOf('--run');
  assert.ok(sep > 0, '--run is present');
  assert.equal(args[sep + 1], '--', '"--run --" precedes the program argv');
  const single = new Map<string, string>();
  const env: string[] = [];
  const dirs: string[] = [];
  for (const a of args.slice(0, sep)) {
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(a);
    assert.ok(m, `unexpected isolate argument ${a}`);
    const [, name, value = ''] = m;
    if (name === 'env') env.push(value);
    else if (name === 'dir') dirs.push(value);
    else {
      assert.ok(!single.has(name), `--${name} given twice`);
      single.set(name, value);
    }
  }
  return { single, env, dirs, argv: args.slice(sep + 2) };
}

function envOf(box: BoxSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of flags(isolateRunArgs(7, box, FILES)).env) {
    const i = e.indexOf('=');
    out[e.slice(0, i)] = e.slice(i + 1);
  }
  return out;
}

test('run boxes: the program argv per language', () => {
  const expected: Record<SandboxLanguage, string[]> = {
    python: ['/usr/bin/env', 'python3', 'main.py'],
    javascript: ['/usr/bin/env', 'node', 'main.js'],
    cpp: ['./a.out'],
    java: ['/usr/bin/env', 'java', '-cp', '.', 'Main'],
    go: ['./main'],
  };
  for (const lang of LANGS) {
    assert.deepEqual(flags(isolateRunArgs(7, runBox(lang), FILES)).argv, expected[lang], lang);
  }
});

test('compile boxes: the compiler argv per language', () => {
  assert.deepEqual(flags(isolateRunArgs(100, compileBox('cpp'), FILES)).argv, [
    '/usr/bin/env', 'g++', '-std=c++17', '-O2', '-o', 'a.out', 'main.cpp',
  ]);
  assert.deepEqual(flags(isolateRunArgs(100, compileBox('java'), FILES)).argv, ['/usr/bin/env', 'javac', 'Main.java']);
  const goArgv = flags(isolateRunArgs(100, compileBox('go'), FILES)).argv;
  assert.match(goArgv[0], /(^\/.*\/go$)|^\/usr\/bin\/env$/);
  assert.deepEqual(goArgv.slice(-5), ['build', '-ldflags=-s -w', '-o', 'main', 'main.go']);
  for (const lang of ['python', 'javascript'] as SandboxLanguage[]) {
    assert.throws(() => compileBox(lang), /no compile phase/);
  }
});

test('run boxes: default limits, per-language pid caps, 16 MB file cap, stdin', () => {
  const pids: Record<SandboxLanguage, string> = { python: '1', javascript: '16', cpp: '1', java: '64', go: '16' };
  for (const lang of LANGS) {
    const { single } = flags(isolateRunArgs(7, runBox(lang), FILES));
    assert.equal(single.get('cg'), '', `${lang}: --cg`);
    assert.equal(single.get('box-id'), '7');
    assert.equal(single.get('time'), '10.000');
    assert.equal(single.get('wall-time'), '20.000');
    assert.equal(single.get('cg-mem'), String(256 * 1024));
    assert.equal(single.get('processes'), pids[lang], `${lang}: pid cap`);
    assert.equal(single.get('fsize'), String(16 * 1024), `${lang}: output cap`);
    assert.equal(single.get('stdin'), 'stdin.txt');
    assert.equal(single.get('meta'), FILES.metaPath);
    assert.equal(single.get('stdout'), FILES.stdoutFile);
    assert.equal(single.get('stderr'), FILES.stderrFile);
    assert.equal(single.get('silent'), '');
    assert.ok(!single.has('mem'), `${lang}: no RLIMIT_AS (--mem)`);
  }
});

test('compile boxes: compile limits, no stdin, 64 MB file cap', () => {
  const pids: Record<string, string> = { cpp: '16', java: '64', go: '64' };
  for (const lang of COMPILED) {
    const { single } = flags(isolateRunArgs(100, compileBox(lang), FILES));
    assert.equal(single.get('time'), '15.000', lang);
    assert.equal(single.get('wall-time'), '30.000');
    assert.equal(single.get('cg-mem'), String(512 * 1024));
    assert.equal(single.get('processes'), pids[lang], `${lang}: compile pid cap`);
    assert.equal(single.get('fsize'), String(64 * 1024));
    assert.ok(!single.has('stdin'), `${lang}: a compiler reads no stdin`);
  }
});

test('RunOptions override the defaults and the language caps', () => {
  const spec = getLanguageSpec('go');
  const limits = resolveRunLimits(spec, { timeoutMs: 2500, memoryKb: 64 * 1024, pidsLimit: 3 });
  assert.deepEqual(limits, { timeoutMs: 2500, memoryKb: 65536, pidsLimit: 3 });
  const box = runBoxSpec(spec, 'main.go', limits, PLAN, 7);
  const { single } = flags(isolateRunArgs(7, box, FILES));
  assert.equal(single.get('time'), '2.500');
  assert.equal(single.get('wall-time'), '5.000');
  assert.equal(single.get('cg-mem'), '65536');
  assert.equal(single.get('processes'), '3');
  // GOMEMLIMIT follows the memory limit (90%).
  assert.equal(envOf(box).GOMEMLIMIT, '58982KiB');
});

test('syscall filter: strictest everywhere; only the Go compile box may take file locks', () => {
  assert.equal(SYSCALLS_STRICT, 65535);
  assert.equal(SYSCALLS_STRICT & SYSCALL_FILE_LOCKS, SYSCALL_FILE_LOCKS);
  for (const lang of LANGS) {
    assert.equal(flags(isolateRunArgs(7, runBox(lang), FILES)).single.get('syscalls'), '65535', `${lang} run box`);
  }
  assert.equal(flags(isolateRunArgs(100, compileBox('cpp'), FILES)).single.get('syscalls'), '65535');
  assert.equal(flags(isolateRunArgs(100, compileBox('java'), FILES)).single.get('syscalls'), '65535');
  // 65531 = 0xffff without flag 4 (fcntl locks + flock): nothing else relaxed.
  assert.equal(flags(isolateRunArgs(100, compileBox('go'), FILES)).single.get('syscalls'), '65531');
  assert.equal(65531, SYSCALLS_STRICT & ~SYSCALL_FILE_LOCKS);
});

test('core dumps are disabled in every box', () => {
  for (const lang of LANGS) assert.equal(flags(isolateRunArgs(7, runBox(lang), FILES)).single.get('core'), '0');
  for (const lang of COMPILED) assert.equal(flags(isolateRunArgs(100, compileBox(lang), FILES)).single.get('core'), '0');
});

test('every box gets the minimal base environment and nothing from the service', () => {
  process.env.INTERNAL_TOKEN = 'leak-canary-token';
  try {
    const boxes = [...LANGS.map((l) => runBox(l)), ...COMPILED.map((l) => compileBox(l))];
    for (const box of boxes) {
      const args = isolateRunArgs(7, box, FILES);
      assert.ok(!args.some((a) => a.includes('leak-canary')), 'service env never reaches a box');
      assert.ok(!args.includes('--full-env') && !args.includes('-e'), 'no --full-env');
      const env = envOf(box);
      assert.ok(env.PATH.split(':').includes('/usr/bin'), 'PATH has /usr/bin');
      assert.ok(env.LANG === 'C.UTF-8');
      assert.ok(env.HOME === '/box' || env.HOME === '/tmp');
    }
  } finally {
    delete process.env.INTERNAL_TOKEN;
  }
  assert.deepEqual({ ...BOX_BASE_ENV }, { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/box', LANG: 'C.UTF-8' });
});

test('run box environments: exactly the base plus what the language adds', () => {
  for (const lang of ['python', 'javascript', 'cpp', 'java'] as SandboxLanguage[]) {
    assert.deepEqual(envOf(runBox(lang)), { ...BOX_BASE_ENV }, lang);
  }
  assert.deepEqual(envOf(runBox('go')), { ...BOX_BASE_ENV, GOMAXPROCS: '1', GOMEMLIMIT: '235929KiB' });
});

test('/usr/bin comes before /bin: g++ must not resolve itself as /bin/g++', () => {
  const path = envOf(runBox('cpp')).PATH.split(':');
  assert.ok(path.indexOf('/usr/bin') < path.indexOf('/bin'));
  const compilePath = envOf(compileBox('cpp')).PATH.split(':');
  assert.ok(compilePath.indexOf('/usr/bin') < compilePath.indexOf('/bin'));
});

test('compile box environments: g++/javac get the base; go build its toolchain vars', () => {
  assert.deepEqual(envOf(compileBox('cpp')), { ...BOX_BASE_ENV });
  assert.deepEqual(envOf(compileBox('java')), { ...BOX_BASE_ENV });
  const go = envOf(compileBox('go'));
  assert.equal(go.GOTOOLCHAIN, 'local');
  assert.equal(go.CGO_ENABLED, '0');
  assert.equal(go.GOENV, 'off');
  assert.equal(go.GOFLAGS, '', 'empty value: isolate removes the variable');
  assert.equal(go.GODEBUG, 'goindex=0');
  assert.equal(go.HOME, '/tmp');
  assert.ok(go.GOCACHE === '/gocache' || go.GOCACHE === '/tmp/gocache');
  assert.equal(go.LANG, 'C.UTF-8', 'base variables are still there');
});

test('directory rules: only the Go compile box binds the shared build cache', () => {
  for (const lang of LANGS) assert.deepEqual(flags(isolateRunArgs(7, runBox(lang), FILES)).dirs, [], `${lang} run`);
  assert.deepEqual(flags(isolateRunArgs(100, compileBox('cpp'), FILES)).dirs, []);
  assert.deepEqual(flags(isolateRunArgs(100, compileBox('java'), FILES)).dirs, []);
  const goDirs = flags(isolateRunArgs(100, compileBox('go'), FILES)).dirs;
  assert.deepEqual(goDirs, goCompileDirs());
  for (const rule of goDirs) assert.doesNotMatch(rule, /:rw/, 'the shared cache is bound read-only');
});

test('pinning: a run box runs under taskset on its one CPU', () => {
  const box = runBox('java', 9);
  assert.equal(box.cpus, '3'); // box CPUs 1-7: 9 mod 7 = 2 -> CPU 3
  const cmd = isolateCommand(box, 9, FILES, { isolate: '/usr/local/bin/isolate', taskset: '/usr/bin/taskset' });
  assert.equal(cmd.file, '/usr/bin/taskset');
  assert.deepEqual(cmd.args.slice(0, 3), ['-c', '3', '/usr/local/bin/isolate']);
  assert.deepEqual(cmd.args.slice(3), isolateRunArgs(9, box, FILES));
});

test('pinning: run boxes never land on the API CPU; compile boxes get all box CPUs', () => {
  for (let id = 0; id < SANDBOX_CONFIG.isolate.maxBoxes; id++) {
    const cpus = runBox('python', id).cpus!;
    assert.match(cpus, /^[1-7]$/, `box ${id}`);
  }
  assert.equal(compileBox('go', 100).cpus, '1-7');
  assert.equal(compileBox('cpp', 101).cpus, '1-7');
});

test('pinning off: isolate is spawned directly', () => {
  const box = runBox('cpp', 7, null);
  assert.equal(box.cpus, undefined);
  const cmd = isolateCommand(box, 7, FILES, { isolate: 'isolate', taskset: 'taskset' });
  assert.equal(cmd.file, 'isolate');
  assert.equal(cmd.args[0], '--cg');
  assert.equal(compileBox('go', 100, null).cpus, undefined);
});
