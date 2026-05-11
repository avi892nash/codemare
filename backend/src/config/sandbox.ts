/**
 * Centralised sandbox configuration. Limits apply to the *run* phase of user
 * code; compile phases (C++/Java) get a separate, looser budget defined below.
 *
 * The sandbox technology is `isolate` (https://github.com/ioi/isolate). There
 * is no longer a strategy facade — the single adapter dispatches directly.
 */
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
    binary: 'isolate',
  },
} as const;
