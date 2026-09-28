import os from 'node:os';
import path from 'node:path';

/**
 * Centralised sandbox configuration. Limits apply to the *run* phase of user
 * code; compile phases (C++/Java/Go) get a separate, looser budget defined
 * below.
 *
 * The sandbox technology is `isolate` (https://github.com/ioi/isolate). There
 * is no longer a strategy facade — the single adapter dispatches directly.
 */
const HOST_CORES = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);

export const SANDBOX_CONFIG = {
  limits: {
    timeoutMs: 10_000,
    memoryKb: 256 * 1024,
    pidsLimit: 50,
  },
  compileLimits: {
    timeoutMs: 15_000,
    memoryKb: 512 * 1024,
    pidsLimit: 16,
  },
  isolate: {
    maxBoxes: 100,
    // Compile boxes come from their own pool (IDs after the run boxes), so a
    // request holding a run box can never wait on a compile box that only
    // another run-box holder could free — see isolateAdapter. Sized to the
    // cores: compiles are CPU-bound, more in parallel only thrash.
    compileBoxes: Math.max(2, HOST_CORES),
    binary: 'isolate',
  },
  compileCache: {
    // Content-addressed cache of compiled artifacts (a.out / *.class / Go
    // binary) keyed on (language, compiler argv, source). A re-run of
    // unchanged C++/Java/Go code skips compilation entirely. Bounded LRU;
    // entries are evicted oldest-first and their artifact dirs removed.
    enabled: true,
    maxEntries: 256,
  },
  go: {
    // Shared Go build cache, warmed at startup (see sandbox/goToolchain.ts).
    // The default lives under the service's (private) tmp dir, which is
    // writable under the systemd unit's ProtectSystem=strict.
    buildCacheDir:
      process.env.GO_BUILD_CACHE_DIR?.trim() || path.join(os.tmpdir(), 'codemare-gocache'),
    // GOMAXPROCS for `go build` itself.
    compileMaxProcs: 2,
  },
} as const;
