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
- Go ≥ 1.22 — the distro `golang-go` when it is new enough (Ubuntu 24.04),
  otherwise the latest official tarball from go.dev (checksum-verified) into
  `/usr/local/go`, linked as `/usr/local/bin/go`. TypeScript needs nothing on
  the host: it is transpiled in-process (the `typescript` npm package).
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

This service is **not** publicly addressable. Every request to `/v1/*`
requires the header `X-Codemare-Token: <shared-secret>`. The secret lives in
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
curl -s -X POST http://localhost:3000/v1/run \
  -H 'Content-Type: application/json' \
  -H "X-Codemare-Token: ${TOKEN}" \
  -d '{"language":"go","code":"func add(a int, b int) int { return a + b }","functionName":"add",
       "signature":{"params":[{"name":"a","type":"int"},{"name":"b","type":"int"}],"returns":"int"},
       "tests":[{"input":[1,2],"expected":3}]}'
# → {"status":"OK","totalPassed":1,...}; POST /v1/run/stream gives the same run as SSE
```

The boot log should warm the Go build cache, print `Sandbox: isolate` and
list the available languages:

```
Go build cache: warm in 9000 ms (/tmp/codemare-gocache)
Sandbox: isolate
  Available: python, javascript, typescript, cpp, java, go
```

## Security model

The exact command line of every box is built in
[src/services/sandbox/isolateCommand.ts](src/services/sandbox/isolateCommand.ts)
and pinned by `tests/sandbox/isolateCommand.test.ts`; requires isolate ≥ 2.7.

- `isolate` runs each submission in its own mount, PID, IPC and network
  namespaces, as a per-box uid, with a chroot of read-only `/usr`, `/bin`,
  `/lib*`, `/dev`, its own `/proc` (only the box's processes) and a writable
  `/box` and `/tmp`.
- `--cg --cg-mem=N` enforces memory caps via cgroups v2 (plain `--mem` is an
  address-space rlimit that Go, the JVM and V8 cannot even start under).
- `--processes=N`, `--time`, `--wall-time` cap fork count, CPU and wall time.
- `--fsize` caps every file a program writes, stdout and stderr included
  (16 MB run, 64 MB compile): past it the verdict is RE "Output limit
  exceeded". The service reads box files with O_NOFOLLOW and within a budget.
- `--core=0`: no core files. `--syscalls=65535`: isolate's full syscall
  filter, except that Go compile boxes may take file locks (`go build`
  needs them).
- Environment: only `PATH=/usr/local/bin:/usr/bin:/bin`, `HOME=/box`,
  `LANG=C.UTF-8` and the language's own variables. isolate itself is started
  with `PATH` only, so `INTERNAL_TOKEN` reaches no sandbox process.
- CPU pinning (`ISOLATE_CPU_PINNING=round-robin|off`,
  [src/services/sandbox/cpuPinning.ts](src/services/sandbox/cpuPinning.ts)):
  one CPU per run box via `taskset`; binding only where isolate's config
  gives each box a cpuset (the Docker image's entrypoint writes them). The
  startup log says `enforced` or `ADVISORY ONLY`.
- Network is private (a fresh `netns` per box with only `lo`).
- The setuid bit on `isolate` is required so the unprivileged `codemare` user
  can request namespace creation. The systemd unit has
  `NoNewPrivileges=false` for that reason; the backend itself never elevates.

## Operational knobs

- **Concurrency**: `SANDBOX_CONFIG.isolate.maxBoxes = 100` in
  [src/config/sandbox.ts](src/config/sandbox.ts). The acquire/release semaphore
  in [src/services/sandbox/boxPool.ts](src/services/sandbox/boxPool.ts)
  guarantees no box-id collisions across concurrent requests.
  Compile boxes come from a separate pool (`compileBoxes`, one per core, IDs
  after the run boxes) so run-box holders can never deadlock waiting on them.
- **Limits per submission**: `SANDBOX_CONFIG.limits` — 10 s CPU, 256 MB, 50
  PIDs (callers of `/v1/run` pass their own `limits`, capped at 10 s /
  512 MB). Compile phase uses `compileLimits` — 15 s, 512 MB, 16 PIDs (64
  for javac and `go build`).
- **Compile cache**: compiled artifacts are cached by (language, compiler
  argv, source) in the service's tmp dir, an LRU bounded at 256 entries and
  by `COMPILE_CACHE_MAX_MB` (default 1024, at least 64) — artifacts on disk
  plus cached compiler output. One binary can reach the 64 MB compile file
  cap, so keep the budget well above a few of those. See
  [src/services/sandbox/compileCache.ts](src/services/sandbox/compileCache.ts).
- **Go build cache**: warmed at startup into `GO_BUILD_CACHE_DIR` (default
  `$TMPDIR/codemare-gocache`, i.e. the unit's private `/tmp`) and bound
  **read-only** into compile boxes, so untrusted builds reuse the compiled
  standard library but can't write to it. See
  [src/services/sandbox/goToolchain.ts](src/services/sandbox/goToolchain.ts).
- **Languages**: defined in
  [src/services/sandbox/languageSpec.ts](src/services/sandbox/languageSpec.ts).
  Adding Rust / Kotlin is ~10 lines plus installing the toolchain in
  `deploy/install.sh`.

## What's NOT in this repo anymore

- No per-language executor images (`backend/docker/*-executor/`) and no
  Docker-in-Docker: every run is an isolate box.
- No Kubernetes manifests (the DinD sidecar was retired).

The service's own image (`backend/Dockerfile`) and the Compose stack
(`docker-compose.prod.yml`, runbook in `deploy/README.md`) are the current
deploy path; the systemd setup in this document is the older alternative.

For local dev on macOS/Windows, the backend falls back to an unsandboxed
`localAdapter` (loud warning on boot) so `npm run dev` works without isolate.
That fallback is refused in production (`NODE_ENV=production` throws if isolate
is missing) — see [src/services/sandboxService.ts](src/services/sandboxService.ts).

## Scaling: synchronous vs. queued

`POST /v1/run` and `POST /v1/run/stream` (all judging: runs, submits, gate
attempts, build steps, reference solutions) always run inline in the API
process; they never touch a queue. The optional queue serves IDE mode
(`POST /v1/ide/execute`) only, and whether it is on is chosen by whether
`REDIS_URL` is set.

**Synchronous (default, single-node).** No Redis. Every request runs inline
and answers with its result. Concurrency is bounded by the in-memory BoxPool
(100 isolate boxes) on the one host. Simplest; fine until a single VM's cores
are the bottleneck.

**Queued (IDE mode).** Set `REDIS_URL`. `POST /v1/ide/execute` (without
`?wait=true`) enqueues the run and returns `{ token }` (202); clients poll
`GET /v1/ide/execute/:token` (the web app's compile client does this
transparently). Workers drain the queue:

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
  VM/process, all sharing one `REDIS_URL`. Scale IDE execution by adding
  workers without touching the API tier.
- Single VM: set `WORKER_INLINE=true` to run a worker inside the API process —
  you still get the async API + backpressure without a separate process.

Relevant env (in `/etc/codemare/env`):

```
REDIS_URL=redis://10.0.0.5:6379    # unset → synchronous mode
WORKER_CONCURRENCY=<cores>         # jobs one worker runs at once — defaults to os.cpus().length
QUEUE_RESULT_TTL_SEC=3600          # how long completed results are retained
WORKER_INLINE=true                 # single-VM: run a worker in the API process
EXECUTION_RATE_LIMIT_MAX=6000      # circuit breaker: requests/min per API process, all execution routes together
```

The backend is stateless either way: no problem catalog and no DB — the
caller sends the code and the tests with every run. Submission history lives
in the web app's Postgres, not here.

## Capacity planning: what it takes to hit 1000 req/s

Two very different numbers hide behind "1000 requests per second" for a judge,
and they need different fixes.

**The API layer (health checks, polling, request handling) is not the
bottleneck.** Measured on a 10-core dev machine, one Node process serves
`/health` at ~16k req/s. Clustering or extra hardware for this tier isn't
needed until well past 1000 req/s.

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
run phase — more if the mix skews toward C++/Java cache misses. The queued
architecture above scales IDE runs that way today (point N worker hosts at one
`REDIS_URL`); `/v1/run` and `/v1/run/stream` run inline on the API host, so
scaling judging past one host would need the streaming path to learn the
queue. There is no single-process or single-host trick that gets a
code-execution judge to 1000 req/s of *real, isolated* executions — that
number is a hardware/fleet-size question, not a software-efficiency one.

**What was actually a software bug, and is now fixed:** the execution
endpoints previously rate-limited to 10 requests/minute **per source IP**.
Since this service has exactly one caller (the Next.js server, behind
`requireInternalToken`), every real user's traffic shared that one IP — the
limiter was capping the *entire platform* at 10 submissions/minute, not
guarding against abuse. It's now a generous, configurable circuit breaker
(`EXECUTION_RATE_LIMIT_MAX`, default 6000/min ≈ 100 req/s per API process,
shared by `/v1/run`, `/v1/run/stream` and `/v1/ide/execute`) against a
runaway caller, and real per-user throttling (30 runs/min) lives in the web
app's server actions, where user identity actually exists.
