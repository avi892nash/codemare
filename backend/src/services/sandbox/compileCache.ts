import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { Language } from '../../models/ExecutionResult.js';
import { SANDBOX_CONFIG } from '../../config/sandbox.js';
import { SandboxResult } from './types.js';

/**
 * Content-addressed cache of compiled artifacts.
 *
 * The key is sha256(language + compiler argv + source). Two properties make
 * this safe and worthwhile:
 *
 *   · Deterministic — g++/javac with fixed flags produce the same artifact for
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
 * Bounded LRU: oldest entry evicted on overflow, its artifact dir removed.
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

type StoredEntry =
  | { kind: 'ok'; dir: string; artifacts: string[]; compileMs: number }
  | { kind: 'fail'; result: SandboxResult };

export class CompileCache {
  /** Insertion-ordered → front is least-recently-used. */
  private readonly entries = new Map<string, StoredEntry>();
  private readonly inflight = new Map<string, Promise<StoredEntry>>();

  constructor(private readonly maxEntries: number) {}

  key(language: Language, compileArgv: string[], code: string): string {
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
          ? { kind: 'ok', dir: fresh.dir, artifacts: fresh.artifacts, compileMs: fresh.compileMs }
          : { kind: 'fail', result: fresh.result };
      this.store(key, entry);
      return entry;
    })();

    this.inflight.set(key, run);
    return run
      .then((entry) => toOutcome(entry, false))
      .finally(() => this.inflight.delete(key));
  }

  private store(key: string, entry: StoredEntry): void {
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const evicted = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (evicted?.kind === 'ok') {
        // Best-effort; the dir is no longer referenced.
        void rm(evicted.dir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  size(): number {
    return this.entries.size;
  }

  /** Test helper: drop everything and remove artifact dirs. */
  async clear(): Promise<void> {
    const dirs = [...this.entries.values()]
      .filter((e): e is Extract<StoredEntry, { kind: 'ok' }> => e.kind === 'ok')
      .map((e) => e.dir);
    this.entries.clear();
    this.inflight.clear();
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }).catch(() => undefined)));
  }
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
export const compileCache = new CompileCache(SANDBOX_CONFIG.compileCache.maxEntries);
