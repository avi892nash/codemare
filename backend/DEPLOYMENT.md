# Codemare backend — deployment

The backend runs as a plain Node process under `systemd` on a single Linux VM.
User code is sandboxed with [`isolate`](https://github.com/ioi/isolate). There
is no Docker on the host and no Docker socket mounted into the backend.

## Prerequisites (Linux host)

- Ubuntu 22.04+ / Debian 12+ / RHEL 9+ (cgroups v2; kernel ≥ 5.8)
- Root access for one-time provisioning
- Domain + TLS termination upstream (nginx / caddy / cloud LB) — out of scope here

## One-shot provisioning

From the repo root, on the target VM:

```bash
sudo bash deploy/install.sh
```

`install.sh` verifies cgroups v2 and then installs:

- `isolate` (setuid root, ~200 KB) — the sandbox
- `nodejs` 20+
- `python3`, `default-jdk-headless`, `g++` — language toolchains
- Creates the `codemare` system user + `/opt/codemare/backend` and `/var/log/codemare`
- Drops `deploy/codemare-backend.service` into `/etc/systemd/system/` and reloads systemd

## Release

From a dev machine that can SSH to the VM:

```bash
deploy/release.sh user@your-vm
```

`release.sh`:

1. `npm ci && npm run build` locally
2. `npm ci --omit=dev` into a staging dir
3. `rsync` `dist/`, `node_modules/`, `package*.json` to `/opt/codemare/backend/`
4. `systemctl restart codemare-backend` and verify it is `active`

## Internal auth

This service is **not** publicly addressable. Every request to `/v1/*` and
the legacy `/api/*` aliases requires the header
`X-Codemare-Token: <shared-secret>`. The secret lives in
`/etc/codemare/env` (mode 0640, group `codemare`) and is loaded by the
systemd unit via `EnvironmentFile=`.

`install.sh` generates a fresh 32-byte secret on first run with
`openssl rand -hex 32` and prints it at the end so you can paste it into the
caller's (Next.js) `INTERNAL_TOKEN` env. Rotate by overwriting both sides
and restarting both services.

`/health` is intentionally open for systemd's `Restart=on-failure` checks
and any front-of-house load balancer probe.

## Verify on the VM

```bash
journalctl -u codemare-backend -f          # tail logs
curl http://localhost:3000/health          # → {"status":"ok",...}   (open)
TOKEN=$(sudo grep '^INTERNAL_TOKEN=' /etc/codemare/env | cut -d= -f2-)
curl -s -X POST http://localhost:3000/v1/execute \
  -H 'Content-Type: application/json' \
  -H "X-Codemare-Token: ${TOKEN}" \
  -d '{"problemId":"two-sum","language":"python","code":"def twoSum(nums, target):\n  return [0,1]\n"}'
```

The boot log should print `Sandbox: isolate` and list the available languages:

```
Sandbox: isolate
  Available: python, javascript, java, cpp
```

## Security model

- `isolate` runs each submission in its own Linux namespaces (mount/pid/ipc/uts/net/user).
- `--cg --mem=N` enforces memory caps via cgroups v2.
- `--processes=N`, `--time`, `--wall-time` cap fork count, CPU and wall time.
- `--no-default-dirs` (default) means the box filesystem is empty except for
  what the adapter writes in.
- Network is private (a fresh `netns` per box).
- The setuid bit on `isolate` is required so the unprivileged `codemare` user
  can request namespace creation. The systemd unit has
  `NoNewPrivileges=false` for that reason; the backend itself never elevates.

## Operational knobs

- **Concurrency**: `SANDBOX_CONFIG.isolate.maxBoxes = 100` in
  [src/config/sandbox.ts](src/config/sandbox.ts). The acquire/release semaphore
  in [src/services/sandbox/boxPool.ts](src/services/sandbox/boxPool.ts)
  guarantees no box-id collisions across concurrent requests.
- **Limits per submission**: `SANDBOX_CONFIG.limits` — 10 s CPU, 256 MB, 50
  PIDs. Compile phase uses `compileLimits` — 15 s, 512 MB, 16 PIDs.
- **Languages**: defined in
  [src/services/sandbox/languageSpec.ts](src/services/sandbox/languageSpec.ts).
  Adding Go / Rust / Kotlin is ~10 lines plus installing the toolchain in
  `deploy/install.sh`.

## What's NOT in this repo anymore

- No Dockerfile, no `docker-compose`, no `backend/docker/*-executor/`.
- No Kubernetes manifests (the DinD sidecar was retired).

For local dev on macOS/Windows, the backend falls back to an unsandboxed
`localAdapter` (loud warning on boot) so `npm run dev` works without isolate.
That fallback is refused in production (`NODE_ENV=production` throws if isolate
is missing) — see [src/services/sandboxService.ts](src/services/sandboxService.ts).

## Scaling: synchronous vs. queued

The backend runs in one of two modes, chosen by whether `REDIS_URL` is set.

**Synchronous (default, single-node).** No Redis. `POST /v1/execute` runs the
submission inline and returns the result. Concurrency is bounded by the
in-memory BoxPool (100 isolate boxes) on the one host. Simplest; fine until a
single VM's cores are the bottleneck.

**Queued (horizontal scale).** Set `REDIS_URL`. The API enqueues each
submission and returns `{ token }` (202); clients poll `GET /v1/execute/:token`.
Workers drain the queue:

```
                 ┌─────────────┐     enqueue      ┌─────────┐
  clients  ────▶ │  API (N)    │ ───────────────▶ │  Redis  │
                 │  stateless  │ ◀─── poll ─────── │  queue  │
                 └─────────────┘                   └────┬────┘
                                                        │ pull
                                          ┌─────────────┴──────────────┐
                                          ▼              ▼             ▼
                                      worker 1       worker 2  …   worker M
                                   (isolate + toolchains, own VM/proc)
```

- API hosts: `deploy/codemare-backend.service` (no workers), behind a load balancer.
- Worker hosts: `deploy/codemare-worker.service` — run M of them, each its own
  VM/process, all sharing one `REDIS_URL`. Scale execution by adding workers
  without touching the API tier.
- Single VM: set `WORKER_INLINE=true` to run a worker inside the API process —
  you still get the async API + backpressure without a separate process.

Relevant env (in `/etc/codemare/env`):

```
REDIS_URL=redis://10.0.0.5:6379    # unset → synchronous mode
WORKER_CONCURRENCY=<cores>         # jobs one worker runs at once — defaults to os.cpus().length
QUEUE_RESULT_TTL_SEC=3600          # how long completed results are retained
WORKER_INLINE=true                 # single-VM: run a worker in the API process
EXECUTION_RATE_LIMIT_MAX=6000      # /v1/execute + /v1/ide/execute cap per API process, per minute
```

The backend is stateless either way (file-based problem catalog, no DB).
Submission history lives in the web app's Postgres, not here.

## Capacity planning: what it takes to hit 1000 req/s

Two very different numbers hide behind "1000 requests per second" for a judge,
and they need different fixes.

**The API layer (catalog reads, polling, health checks) is not the
bottleneck.** Measured on a 10-core dev machine, one Node process serves
`/health` at ~16k req/s and `/v1/problems` at ~8k req/s. Clustering or extra
hardware for this tier isn't needed until well past 1000 req/s.

**Executing submitted code is the bottleneck, and it's a hard, physical one.**
A CPU profile of the API process under load (`node --prof` +
`--prof-process`) attributes **81% of CPU time to the `spawn()` syscall
itself** — forking and exec'ing a fresh interpreter/compiler process per
submission. That's not fixable in application code, and shouldn't be "fixed"
by pooling/reusing interpreter processes across submissions — that would let
one user's process state leak into another's, which is a correctness and
security regression for a judge. One clean process per submission is the
right tradeoff; it just has a real per-core ceiling.

Measured on that same 10-core dev machine (unsandboxed `localAdapter`, so a
bit cheaper than production `isolate` — expect somewhat lower numbers behind
real namespaces/cgroups):

| Language | First-time compile | Cached re-run (compile skipped) | Sustained throughput (no compile) |
|---|---|---|---|
| Python / JavaScript | n/a (interpreted) | n/a | **~290 req/s**, flat from 20 to 150 concurrent requests |
| C++ | ~810 ms | run-only, sub-ms | bounded by cores available for compilation |
| Java | ~470 ms | run-only, sub-ms | bounded by cores available for compilation |

The throughput ceiling for the interpreted languages was reproducible and flat
regardless of concurrency (20 → 150 connections, 0 errors throughout) —
confirmation that it's a genuine per-core `fork`/`exec` limit, not a queueing
artifact. The content-addressed compile cache (`SANDBOX_CONFIG.compileCache`)
is what makes C++/Java viable at all here: without it, every submission pays
the ~500–800 ms compile cost, capping throughput at a couple requests per
second per core.

**The math for 1000 req/s of real submissions:** at ~290 spawns/sec/host for
the cheap case, you need on the order of 4 hosts of this size purely for the
run phase — more if the mix skews toward C++/Java cache misses. This is
exactly what the queued architecture above is for: point N worker hosts at
one `REDIS_URL` and scale this tier horizontally. There is no single-process
or single-host trick that gets a code-execution judge to 1000 req/s of *real,
isolated* executions — that number is a hardware/fleet-size question, not a
software-efficiency one.

**What was actually a software bug, and is now fixed:** `/v1/execute` and
`/v1/ide/execute` previously rate-limited to 10 requests/minute **per source
IP**. Since this service has exactly one caller (the Next.js server, behind
`requireInternalToken`), every real user's traffic shared that one IP — the
limiter was capping the *entire platform* at 10 submissions/minute, not
guarding against abuse. It's now a generous, configurable circuit breaker
(`EXECUTION_RATE_LIMIT_MAX`, default 6000/min ≈ 100 req/s) against a runaway
caller, and real per-user throttling (30 runs/min) lives in the web app's
server actions, where user identity actually exists.
