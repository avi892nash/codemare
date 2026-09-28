import { createHash } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { SandboxLanguage } from '../../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { SandboxResult } from './types.js';

/**
 * Content-addressed cache of compiled artifacts.
 *
 * The key is sha256(language + compiler argv + source). Two properties make
 * this safe and worthwhile:
 *
 *   · Deterministic — g++/javac/go with fixed flags produce the same artifact for
 *     the same source, so a hit is always correct for the lifetime of the
 *     process (a new process gets a fresh cache, so a compiler upgrade after a
 *     restart never serves a stale binary).
 *   · Compile dominates — for C++/Java, compilation costs ~100×–1000× the run.
 *     The product's core loop is "edit → run → edit → run", which re-submits
 *     near-identical code repeatedly. Caching the compile turns every re-run
 *     into a pure run.
 *
 * Three behaviours:
 *   1. Hit       — return the stored artifact dir (or the cached CE result).
 *   2. Miss      — run the compile thunk, adopt its artifact dir, store it.
 *   3. In-flight — concurrent callers with the same key (e.g. a parallel IDE
 *                  batch) collapse onto a single compile via single-flight.
 *
 * Bounded LRU, by entry count and by bytes: least-recently-used entries are
 * evicted (their artifact dirs removed) until both bounds hold. The byte
 * budget counts artifacts on disk plus cached compiler output in memory — a
 * single C++ or Go binary may reach the 64 MB compile file cap, so the entry
 * cap alone would let 256 entries pin ~16 GB of the host's disk.
 */

/** What the adapter's compile thunk returns. On success it owns a standalone
 *  artifact dir (NOT a sandbox box, which gets torn down) that the cache adopts. */
export type FreshCompileOutcome =
  | { kind: 'ok'; dir: string; artifacts: string[]; compileMs: number }
  | { kind: 'fail'; result: SandboxResult };

/** What getOrCompile returns to the adapter. `cached` reflects whether this
 *  particular call avoided a compile. */
export type CompileOutcome =
  | { kind: 'ok'; dir: string; artifacts: string[]; compileMs: number; cached: boolean }
  | { kind: 'fail'; result: SandboxResult; cached: boolean };

/** `bytes`: what the entry holds — artifact bytes on disk, or the cached
 *  compiler output of a failure (UTF-8, approximate). */
type StoredEntry =
  | { kind: 'ok'; dir: string; artifacts: string[]; compileMs: number; bytes: number }
  | { kind: 'fail'; result: SandboxResult; bytes: number };

export class CompileCache {
  /** Insertion-ordered → front is least-recently-used. */
  private readonly entries = new Map<string, StoredEntry>();
  private readonly inflight = new Map<string, Promise<StoredEntry>>();
  private totalBytes = 0;

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number = Number.POSITIVE_INFINITY
  ) {}

  key(language: SandboxLanguage, compileArgv: string[], code: string): string {
    return createHash('sha256')
      .update(language)
      .update('\0')
      .update(compileArgv.join('\0'))
      .update('\0')
      .update(code)
      .digest('hex');
  }

  /**
   * Return a cached artifact for `key`, or run `compile` to produce one.
   * Concurrent calls with the same key share a single compile.
   *
   * The cache-hit and in-flight checks run synchronously before any await, so
   * two callers in the same tick can't both start a compile.
   */
  getOrCompile(
    key: string,
    compile: () => Promise<FreshCompileOutcome>
  ): Promise<CompileOutcome> {
    const hit = this.entries.get(key);
    if (hit) {
      // LRU touch: move to the back.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return Promise.resolve(toOutcome(hit, true));
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending.then((entry) => toOutcome(entry, true));
    }

    const run = (async (): Promise<StoredEntry> => {
      const fresh = await compile();
      const entry: StoredEntry =
        fresh.kind === 'ok'
          ? {
              kind: 'ok',
              dir: fresh.dir,
              artifacts: fresh.artifacts,
              compileMs: fresh.compileMs,
              bytes: await artifactBytes(fresh.dir, fresh.artifacts),
            }
          : { kind: 'fail', result: fresh.result, bytes: failureBytes(fresh.result) };
      this.store(key, entry);
      return entry;
    })();

    this.inflight.set(key, run);
    return run
      .then((entry) => toOutcome(entry, false))
      .finally(() => this.inflight.delete(key));
  }

  private store(key: string, entry: StoredEntry): void {
    if (this.entries.has(key)) this.evict(key);
    this.entries.set(key, entry);
    this.totalBytes += entry.bytes;
    // Never the entry just stored (the back of the map): its caller is about
    // to copy from its dir. An entry bigger than the whole budget therefore
    // stays until the next store evicts it.
    while (
      this.entries.size > 1 &&
      (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes)
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.evict(oldestKey);
    }
  }

  private evict(key: string): void {
    const evicted = this.entries.get(key);
    if (!evicted) return;
    this.entries.delete(key);
    this.totalBytes -= evicted.bytes;
    if (evicted.kind === 'ok') {
      // Best-effort; the dir is no longer referenced.
      void rm(evicted.dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** True when `key` is compiled and stored (a getOrCompile would be a pure
   *  hit). An in-flight compile is not "has" — callers waiting on it are
   *  still compiling from the user's point of view. */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  size(): number {
    return this.entries.size;
  }

  /** Bytes held by stored entries (artifacts on disk + cached failures). */
  bytes(): number {
    return this.totalBytes;
  }

  /** Test helper: drop everything and remove artifact dirs. */
  async clear(): Promise<void> {
    const dirs = [...this.entries.values()]
      .filter((e): e is Extract<StoredEntry, { kind: 'ok' }> => e.kind === 'ok')
      .map((e) => e.dir);
    this.entries.clear();
    this.inflight.clear();
    this.totalBytes = 0;
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)));
  }
}

/** Total size of an artifact set; a file that can't be stat'ed counts as 0. */
async function artifactBytes(dir: string, artifacts: string[]): Promise<number> {
  const sizes = await Promise.all(
    artifacts.map((name) =>
      stat(path.join(dir, name)).then(
        (st) => st.size,
        () => 0
      )
    )
  );
  return sizes.reduce((a, b) => a + b, 0);
}

function failureBytes(result: SandboxResult): number {
  return Buffer.byteLength(result.error ?? '') + Buffer.byteLength(result.output ?? '');
}

function toOutcome(entry: StoredEntry, cached: boolean): CompileOutcome {
  return entry.kind === 'ok'
    ? { kind: 'ok', dir: entry.dir, artifacts: entry.artifacts, compileMs: entry.compileMs, cached }
    : { kind: 'fail', result: entry.result, cached };
}

/**
 * Process-wide singleton. Only one sandbox adapter is active per process
 * (chosen at startup), so a single shared cache is correct and lets both the
 * isolate and local adapters reuse the same instance.
 */
export const compileCache = new CompileCache(
  SANDBOX_CONFIG.compileCache.maxEntries,
  SANDBOX_CONFIG.compileCache.maxBytes
);
