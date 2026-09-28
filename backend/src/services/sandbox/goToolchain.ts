import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { SandboxBackendName } from './types.js';

/**
 * Go toolchain plumbing shared by the language spec, both adapters and the
 * startup warm-up.
 *
 * The build cache is the whole performance story for Go: since Go 1.20 the
 * standard library is not shipped precompiled, so a `go build` against an
 * empty GOCACHE recompiles runtime, fmt, strconv, … every time (~3 s on a
 * fast laptop, far more on a small VM) versus ~0.2 s warm.
 *
 * Design:
 *   · At startup the API process (trusted code, outside the sandbox) warms
 *     one cache dir: `go list std` writes the module index for every std
 *     package and a build of a program importing the harness packages plus
 *     the common DSA ones compiles their archives.
 *   · isolate compile boxes bind that dir READ-ONLY at /gocache. Untrusted
 *     compiles can read the warm std archives but can never write to — or
 *     poison — the shared cache. `go build` tolerates cache write failures
 *     for ordinary builds (the user's own package just isn't cached there;
 *     our content-addressed compileCache caches the whole binary anyway).
 *   · Two read-only hazards are handled explicitly: a missing module-index
 *     entry is fatal ("package X is not in std"), so boxes run with
 *     GODEBUG=goindex=0 (and the warm-up indexes all of std regardless);
 *     and `go build` trims the cache once a day and treats a failed
 *     trim.txt write as fatal, so this process keeps trim.txt fresh.
 *   · The local adapter (dev/CI) uses the same dir read-write.
 */

const GO_INSTALL_FALLBACKS = ['/usr/local/go/bin/go', '/usr/lib/go/bin/go'];

let resolvedGoBinary: string | null | undefined;

function isExecutable(file: string): boolean {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute path of the `go` binary: GO_BIN, else the first `go` on PATH, else
 * the usual tarball / distro locations. null when Go isn't installed. The
 * absolute path is used directly in the compile argv, so the isolate box
 * (which has no PATH by default) doesn't need to search for it; GOROOT is
 * derived by `go` itself from its (symlink-resolved) location under /usr.
 */
export function resolveGoBinary(): string | null {
  if (resolvedGoBinary !== undefined) return resolvedGoBinary;
  const override = process.env.GO_BIN?.trim();
  const candidates = [
    ...(override ? [override] : []),
    ...(process.env.PATH ?? '')
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, 'go')),
    ...GO_INSTALL_FALLBACKS,
  ];
  resolvedGoBinary = candidates.find(isExecutable) ?? null;
  return resolvedGoBinary;
}

/** Shared build cache dir (see the module comment). */
export function goBuildCacheDir(): string {
  return SANDBOX_CONFIG.go.buildCacheDir;
}

let sharedCacheDisabled = false;

/**
 * Stop binding the shared cache into isolate compile boxes; they fall back to
 * a private, cold per-box cache. The startup probe calls this if a build
 * against the read-only shared cache fails (the read-only behaviour leans on
 * go build internals — see the module comment), so Go degrades to slow
 * rather than broken.
 */
export function disableSharedGoCache(): void {
  sharedCacheDisabled = true;
}

export function sharedGoCacheEnabled(): boolean {
  return !sharedCacheDisabled && existsSync(goBuildCacheDir());
}

/**
 * Environment for `go build`. Values that change package action IDs (e.g.
 * CGO_ENABLED, GOFLAGS) must match between the warm-up and the boxes or the
 * warm archives would never be hit — hence one function for both.
 */
export function goCompileEnv(backend: SandboxBackendName): Record<string, string> {
  const common: Record<string, string> = {
    // Never try to download a newer toolchain (boxes have no network anyway).
    GOTOOLCHAIN: 'local',
    // Pure-Go static binaries: no gcc in the loop, nothing to link at runtime.
    CGO_ENABLED: '0',
    GOFLAGS: '',
    // Ignore any user-level `go env -w` config and stray go.work files.
    GOENV: 'off',
    GOWORK: 'off',
    // Bounds go build's own parallelism (-p defaults to GOMAXPROCS), which
    // keeps the task count well under the compile pid cap.
    GOMAXPROCS: String(SANDBOX_CONFIG.go.compileMaxProcs),
  };
  if (backend === 'local') {
    return {
      ...common,
      GOCACHE: goBuildCacheDir(),
      GOPATH: path.join(os.tmpdir(), 'codemare-gopath'),
      // The service user's real HOME is hidden by the unit's ProtectHome=true.
      HOME: path.join(os.tmpdir(), 'codemare-gohome'),
    };
  }
  const goBin = resolveGoBinary();
  const shared = sharedGoCacheEnabled();
  return {
    ...common,
    PATH: [goBin ? path.dirname(goBin) : null, '/usr/local/go/bin', '/usr/local/bin', '/usr/bin', '/bin']
      .filter(Boolean)
      .join(':'),
    // /tmp is the box's private, writable temp dir.
    HOME: '/tmp',
    GOPATH: '/tmp/go',
    // Read-only warm cache when it exists; otherwise a throwaway per-box
    // cache (correct, just cold).
    GOCACHE: shared ? '/gocache' : '/tmp/gocache',
    GODEBUG: 'goindex=0',
  };
}

/** isolate `--dir` rule binding the warm cache read-only (no `:rw`). */
export function goCompileDirs(): string[] {
  return sharedGoCacheEnabled() ? [`/gocache=${goBuildCacheDir()}`] : [];
}

/**
 * Runtime environment for a compiled Go program. GOMAXPROCS=1 keeps the Go
 * scheduler from running goroutines in parallel (the CP no-parallelism
 * convention, and a small, predictable thread count under the pid cap).
 * GOMEMLIMIT at ~90% of the memory limit makes the GC work harder near the
 * cap instead of the process being OOM-killed as early.
 */
export function goRunEnv(memoryKb: number): Record<string, string> {
  return {
    GOMAXPROCS: '1',
    GOMEMLIMIT: `${Math.max(1024, Math.floor(memoryKb * 0.9))}KiB`,
  };
}

/** Packages the warm-up program compiles into the cache. */
const WARM_PACKAGES = [
  // Everything the generated harness imports.
  'fmt',
  'os',
  'runtime',
  'strconv',
  'syscall',
  'time',
  'math',
  // What DSA solutions commonly reach for.
  'bufio',
  'bytes',
  'cmp',
  'container/heap',
  'container/list',
  'container/ring',
  'errors',
  'maps',
  'math/big',
  'math/bits',
  'math/rand',
  'regexp',
  'slices',
  'sort',
  'strings',
  'unicode',
  'unicode/utf8',
];

function runGo(
  goBin: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(goBin, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c.toString()));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/** `go build` in a box skips its daily trim while trim.txt is < 24 h old. */
export async function refreshGoTrimStamp(): Promise<void> {
  await writeFile(
    path.join(goBuildCacheDir(), 'trim.txt'),
    String(Math.floor(Date.now() / 1000))
  );
}

let trimTimer: NodeJS.Timeout | undefined;

/**
 * Warm the shared build cache. Never throws: a failure only means Go
 * compiles run cold. Returns a one-line status for the startup log.
 */
export async function warmGoBuildCache(timeoutMs = 180_000): Promise<string> {
  const goBin = resolveGoBinary();
  if (!goBin) return 'skipped (go not found)';
  const started = Date.now();
  const cacheDir = goBuildCacheDir();
  const work = await mkdtemp(path.join(os.tmpdir(), 'codemare-gowarm-'));
  try {
    await mkdir(cacheDir, { recursive: true });
    const env = goCompileEnv('local');
    // 1. Module index for every std package (see the module comment).
    const list = await runGo(goBin, ['list', 'std'], work, env, timeoutMs);
    if (list.code !== 0) return `failed: go list std: ${list.stderr.trim().slice(0, 300)}`;
    // 2. Compiled archives for the harness + common packages.
    const program =
      'package main\n\nimport (\n' +
      WARM_PACKAGES.map((p) => `\t_ ${JSON.stringify(p)}\n`).join('') +
      ')\n\nfunc main() {}\n';
    await writeFile(path.join(work, 'main.go'), program);
    const build = await runGo(
      goBin,
      ['build', '-o', path.join(work, 'warm'), 'main.go'],
      work,
      env,
      timeoutMs
    );
    if (build.code !== 0) return `failed: go build: ${build.stderr.trim().slice(0, 300)}`;
    await refreshGoTrimStamp();
    if (!trimTimer) {
      trimTimer = setInterval(() => void refreshGoTrimStamp().catch(() => undefined), 60 * 60 * 1000);
      trimTimer.unref();
    }
    return `warm in ${Date.now() - started} ms (${cacheDir})`;
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
