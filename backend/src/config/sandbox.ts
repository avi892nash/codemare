import os from 'node:os';
import path from 'node:path';
import { parsePinningMode } from '../services/sandbox/cpuPinning.js';

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
    // The most a program may write. Under isolate its stdout, its stderr and
    // every file it creates are each capped at this size (--fsize); the
    // local adapter kills the process instead. The service never reads more
    // than this, and a program that hits it gets "Output limit exceeded".
    outputKb: 16 * 1024,
  },
  compileLimits: {
    timeoutMs: 15_000,
    memoryKb: 512 * 1024,
    pidsLimit: 16,
    // Per-file cap in compile boxes (--fsize): binaries, .class files and Go
    // build-cache entries. The largest legitimate file is a ~13 MB standard
    // library archive when Go builds with a private cache.
    fsizeKb: 64 * 1024,
  },
  isolate: {
    // Run boxes use isolate box ids 0 .. maxBoxes-1.
    maxBoxes: 100,
    // Compile boxes come from their own pool (ids maxBoxes .. maxBoxes +
    // compileBoxes - 1), so a request holding a run box can never wait on a
    // compile box that only another run-box holder could free — see
    // isolateAdapter. Sized to the cores: compiles are CPU-bound, more in
    // parallel only thrash.
    compileBoxes: Math.max(2, HOST_CORES),
    binary: 'isolate',
    // One CPU per run box (sandbox/cpuPinning.ts). ISOLATE_CPU_PINNING:
    // "round-robin" (default) or "off".
    cpuPinning: parsePinningMode(process.env.ISOLATE_CPU_PINNING),
    // How much of a box's stderr (and of a compiler's output) the service
    // keeps: the first and last halves when it is longer, so both Python's
    // traceback (at the end) and a compiler's first error (at the top)
    // survive.
    stderrReadBytes: 1024 * 1024,
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
