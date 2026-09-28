import { readdir } from 'node:fs/promises';
import { SandboxLanguage } from '../../models/ExecutionResult.js';
import { goCompileDirs, goCompileEnv, goRunEnv, resolveGoBinary } from './goToolchain.js';
import { LanguageSpec } from './types.js';

/**
 * Expand artifact name patterns against a directory listing. A pattern may
 * contain `*` (e.g. "*.class"); plain names pass through untouched. Needed for
 * Java, where one source file can produce several .class files (the Problems
 * harness compiles a Solution class alongside Main; user code may also declare
 * inner/anonymous classes) whose names aren't known before compiling.
 */
export async function resolveArtifactNames(
  dir: string,
  patterns: string[]
): Promise<string[]> {
  let listing: string[] | undefined;
  const resolved: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.includes('*')) {
      resolved.push(pattern);
      continue;
    }
    if (!listing) listing = await readdir(dir);
    const re = new RegExp(
      '^' +
        pattern
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        '$'
    );
    resolved.push(...listing.filter((name) => re.test(name)));
  }
  return resolved;
}

/**
 * Extract the public class name from Java source. Falls back to "Main" if no
 * `public class X` declaration is found. Ported from the legacy
 * docker/java-executor/executor.py regex.
 */
export function detectJavaClassName(code: string): string {
  const match = code.match(/public\s+class\s+(\w+)/);
  return match ? match[1] : 'Main';
}

/**
 * pidsLimit reasoning (per CP convention — no parallel threading):
 *   cpp:        1   — truly single-threaded; std::thread is denied.
 *   python:     1   — CPython has a GIL; multiprocessing/threading is blocked.
 *   javascript: 16  — Node needs ~7 tasks just to boot (libuv pool, V8 GC,
 *                     inspector, signal handler). 16 leaves margin for normal
 *                     async I/O but is too tight for `new Worker(...)` abuse.
 *   java:       64  — JVM creates ~25 internal threads at startup (GC, JIT,
 *                     reference handler, finalizer, signal dispatcher, …).
 *                     64 leaves headroom for ForkJoinPool.common defaults
 *                     while still capping user-spawned thread pools.
 *   go:         16  — the runtime needs a handful of threads (sysmon, the
 *                     locked main thread, one to run the P while main is
 *                     parked, GC). GOMAXPROCS=1 (goRunEnv) keeps it there.
 *
 * Compile-phase caps: javac is a multi-threaded JVM and `go build` runs the
 * go command plus compile/link processes, each multi-threaded, so both get
 * 64 instead of the default compile cap of 16 (enough for g++).
 *
 * The pid caps (isolate --processes = RLIMIT_NPROC) are defence-in-depth and
 * a fork-bomb stop. Parallelism itself is stopped by CPU pinning: every run
 * box gets exactly one CPU (cpuPinning.ts), so threads time-share it.
 */
const SPECS: Record<SandboxLanguage, LanguageSpec> = {
  python: {
    language: 'python',
    needsCompile: false,
    mainFileName: () => 'main.py',
    runArgv: (mainFile) => ['/usr/bin/env', 'python3', mainFile],
    pidsLimit: 1,
  },
  javascript: {
    language: 'javascript',
    needsCompile: false,
    mainFileName: () => 'main.js',
    runArgv: (mainFile) => ['/usr/bin/env', 'node', mainFile],
    pidsLimit: 16,
  },
  cpp: {
    language: 'cpp',
    needsCompile: true,
    mainFileName: () => 'main.cpp',
    compileArgv: (mainFile) => [
      '/usr/bin/env',
      'g++',
      '-std=c++17',
      '-O2',
      '-o',
      'a.out',
      mainFile,
    ],
    runArgv: () => ['./a.out'],
    artifacts: () => ['a.out'],
    pidsLimit: 1,
  },
  java: {
    language: 'java',
    needsCompile: true,
    mainFileName: (code) => `${detectJavaClassName(code)}.java`,
    compileArgv: (mainFile) => ['/usr/bin/env', 'javac', mainFile],
    runArgv: (mainFile) => {
      const className = mainFile.replace(/\.java$/, '');
      return ['/usr/bin/env', 'java', '-cp', '.', className];
    },
    // Glob: javac emits one .class per top-level/inner class, and the Problems
    // harness always produces at least Main.class + Solution.class. The
    // adapters expand this against the compile dir via resolveArtifactNames.
    artifacts: () => ['*.class'],
    pidsLimit: 64,
    compilePidsLimit: 64,
  },
  go: {
    language: 'go',
    needsCompile: true,
    mainFileName: () => 'main.go',
    // `go build` on a single file needs no go.mod (it builds the synthetic
    // command-line-arguments package). -s -w drops the symbol table/DWARF:
    // smaller binary, faster link; panics still print file:line (pclntab).
    compileArgv: (mainFile) => [
      ...(resolveGoBinary() ? [resolveGoBinary() as string] : ['/usr/bin/env', 'go']),
      'build',
      '-ldflags=-s -w',
      '-o',
      'main',
      mainFile,
    ],
    runArgv: () => ['./main'],
    artifacts: () => ['main'],
    pidsLimit: 16,
    compilePidsLimit: 64,
    // `go build` flock()s its build cache (trim.txt, cache entries) and exits
    // 1 when locking is blocked ("function not implemented").
    compileNeedsFileLocks: true,
    compileEnv: (backend) => goCompileEnv(backend),
    compileDirs: () => goCompileDirs(),
    runEnv: (_backend, { memoryKb }) => goRunEnv(memoryKb),
  },
};

export function getLanguageSpec(language: SandboxLanguage): LanguageSpec {
  const spec = SPECS[language];
  if (!spec) {
    throw new Error(`Unsupported language: ${language}`);
  }
  return spec;
}
