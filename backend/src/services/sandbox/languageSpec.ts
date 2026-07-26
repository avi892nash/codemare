import { readdir } from 'node:fs/promises';
import { Language } from '../../models/ExecutionResult.js';
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
 *
 * The real fairness lever is CPU pinning (one core per run box) — see
 * isolateAdapter. The pid caps are defence-in-depth and a fork-bomb stop.
 */
const SPECS: Record<Language, LanguageSpec> = {
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
  },
};

export function getLanguageSpec(language: Language): LanguageSpec {
  const spec = SPECS[language];
  if (!spec) {
    throw new Error(`Unsupported language: ${language}`);
  }
  return spec;
}
