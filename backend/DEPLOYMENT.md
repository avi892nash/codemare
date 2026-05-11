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
- No macOS dev fallback — the only sandbox is `isolate`, which is Linux-only.
  For local dev, use a Linux VM (Multipass / Lima / a remote box) or SSH to
  the same VM that hosts staging.

## Horizontal scaling later

The backend is stateless (file-based problem catalog, no DB). To scale:
provision a second VM with `deploy/install.sh`, put both behind a load
balancer, and replicate `/var/log/codemare` to your log sink. Submission
history will land in a managed Postgres separately when that feature ships.
