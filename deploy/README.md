# Codemare operations runbook

Everything runs on **one Hetzner VPS with Docker Compose** (`docker-compose.prod.yml`
at the repo root). This document covers sizing, provisioning, DNS, the first
deploy, updates and rollbacks, secrets, Directus, backups and restores,
monitoring, and the sandbox (isolate) requirements.

```
Internet ──▶ caddy :80/:443 (TLS, only published ports)
              ├─ APP_DOMAIN   ─▶ web (Next.js standalone)  ──X-Codemare-Token──▶ backend (isolate, privileged)
              └─ ADMIN_DOMAIN ─▶ directus (CMS + recipe editor)
                                   │                                  │
                          postgres 16  { app.*  content.*  directus.*  public._prisma_migrations }
                                   │
                          backup ──restic/SFTP──▶ Hetzner Storage Box (encrypted)
```

Networks: `edge` (caddy, web, directus, backup: has internet) and `internal`
(`internal: true`, no route out: postgres, backend, plus web/directus/backup to reach them).
The compile service and the database therefore cannot reach the internet at all.

Start-up order on every `up`: `postgres` → **db-init** (roles, schemas, grants)
→ **migrate** (`prisma migrate deploy`, optional first seed) → `web` + `directus`
→ **directus-config** (applies `admin/content-model`). The three bold services are
one-shots that exit 0.

| file | what |
|---|---|
| `docker-compose.prod.yml` | the production stack |
| `docker-compose.yml` | local dev: postgres + directus (+ `--profile app`: web, backend) |
| `deploy/.env.example` | every setting; copy to `deploy/.env` (git-ignored) |
| `deploy/deploy.sh` | build, pre-deploy backup, roll out, health-wait; `rollback <tag>` |
| `deploy/caddy/Caddyfile` | TLS + reverse proxy |
| `deploy/postgres/db-init.sql` | roles, schemas, grants (idempotent) |
| `deploy/backend/` | compile-service entrypoint (cgroups, isolate config), g++ shim |
| `deploy/web/docker-entrypoint.sh` | migrate (+ optional seed), then the server |
| `deploy/backup/` | backup image: nightly pg_dump → restic, restore tooling |
| `admin/` | Directus image, content model, the codemare extension (recipe editor) |
| `web/Dockerfile`, `backend/Dockerfile` | the two app images |

`deploy/install.sh`, `release.sh` and the `*.service` units are the older
systemd path for running the compile service on its own VM; the compose stack
does not use them.

---

## 1. Sizing

The compile service dominates: every submission is a fresh process (compile box
+ run box), pinned to one CPU, with µs CPU timing. Shared vCPUs add steal time
to those measurements, so prefer **dedicated vCPUs**.

| stage | Hetzner Cloud | notes |
|---|---|---|
| staging / small launch | 4 dedicated vCPU, 16 GB (CCX23-class) | ~4 submissions in parallel without contention |
| growing | 8 dedicated vCPU, 32 GB (CCX33-class) | raise `BACKEND_MEMORY_LIMIT` with it |
| minimum that works | 2 vCPU, 8 GB (CCX13 / CX-class) | timing noisier on shared vCPUs |

Measured at idle in the local verification: directus ≈ 270 MB, postgres ≈ 75 MB,
web ≈ 50 MB, backend ≈ 30 MB, caddy ≈ 20 MB. Each running box is capped by the
compile service (run 256 MB, compile 512 MB); `BACKEND_MEMORY_LIMIT` (default
4g) caps the server plus all boxes together. Disk: 40 GB is plenty (images
≈ 3 GB, database small). Arm (CAX) works too: every image builds natively on
arm64 (verified) and amd64.

Storage Box: BX11 (1 TB) is more than enough; restic deduplicates nightly dumps.

## 2. Provisioning the VPS

1. Create the server: **Debian 12** or **Ubuntu 24.04** (both boot with cgroup v2),
   your SSH key, IPv4 + IPv6. Put a **Hetzner Cloud Firewall** in front of it:
   inbound TCP 22 (your admin IPs only), TCP 80, TCP 443, UDP 443; nothing else.
   Use the Cloud Firewall rather than ufw: Docker's published ports bypass ufw.
2. Basics:
   ```bash
   apt-get update && apt-get -y upgrade
   apt-get -y install git unattended-upgrades
   stat -fc %T /sys/fs/cgroup        # must print cgroup2fs
   swapon --show                      # should print nothing (isolate memory caps ignore swap)
   ```
3. Docker Engine + compose plugin from Docker's apt repository
   (https://docs.docker.com/engine/install/debian/), then a deploy user:
   ```bash
   adduser --disabled-password deploy && usermod -aG docker deploy
   install -d -o deploy -g deploy /opt/codemare
   sudo -u deploy git clone <repo-url> /opt/codemare
   ```
   Log in as `deploy` for everything below, from `/opt/codemare`.
4. SSH hardening (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`).

## 3. DNS

Point both names at the VPS (A and AAAA records), e.g.

```
codemare.example.com        A     <ipv4>     AAAA <ipv6>
admin.codemare.example.com  A     <ipv4>     AAAA <ipv6>
```

Caddy requests Let's Encrypt certificates on first start (HTTP-01/TLS-ALPN on
80/443) and renews them itself; the records must resolve before the first start.
Optional: a CAA record `0 issue "letsencrypt.org"`.

## 4. Secrets

All configuration is in `deploy/.env` (mode 600, never committed) plus two
files in `deploy/secrets/` (ignored by git). Create them once:

```bash
cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
# fill the CHANGE-ME values; hex keeps passwords URL-safe (they end up in DSNs):
for v in POSTGRES_PASSWORD CODEMARE_DB_PASSWORD DIRECTUS_DB_PASSWORD BACKUP_DB_PASSWORD \
         INTERNAL_TOKEN DIRECTUS_SECRET RESTIC_PASSWORD; do echo "$v=$(openssl rand -hex 32)"; done
echo "AUTH_SECRET=$(openssl rand -base64 32)"
```

| secret | used by | rotate |
|---|---|---|
| `POSTGRES_PASSWORD` | superuser: db-init, restores | only read at initdb: `ALTER ROLE postgres PASSWORD …` in psql, then update `.env` |
| `CODEMARE_DB_PASSWORD`, `DIRECTUS_DB_PASSWORD`, `BACKUP_DB_PASSWORD` | the three roles | edit `.env`, `docker compose … up -d` (db-init re-applies passwords before the services restart) |
| `INTERNAL_TOKEN` | web → backend | edit, `up -d` (both containers restart) |
| `AUTH_SECRET` | Auth.js JWTs | edit, `up -d`; signs everyone out |
| `DIRECTUS_SECRET` | Directus tokens | edit, `up -d`; Directus sessions end |
| `DIRECTUS_ADMIN_PASSWORD` | first-boot admin + the directus-config job | change it in Directus, then in `.env` |
| `RESTIC_PASSWORD` | backup encryption | **never just edit it**: `restic key add` / `key remove` inside the backup container; keep a copy off the server, without it backups cannot be restored |
| `deploy/secrets/storagebox_ed25519` | SSH key for the storage box | new key, `install-ssh-key`, remove the old one from the box |

The GitHub OAuth app's callback is `https://APP_DOMAIN/api/auth/callback/github`.
Password-reset mail goes through Resend when `RESEND_API_KEY` and `MAIL_FROM` are
set; otherwise the links are only printed in the web log.

## 5. First deploy

```bash
# storage box access (section 8.1) → deploy/secrets/storagebox_ed25519 + storagebox_known_hosts
# in deploy/.env: SEED_ON_START=true for this first run only
deploy/deploy.sh
```

`deploy.sh` builds the four images tagged with the commit (`codemare/*:<sha>`),
records the tag as `CODEMARE_VERSION` in `deploy/.env`, starts everything and
waits until web, backend, directus, caddy and postgres report healthy. Then:

1. Set `SEED_ON_START=false` in `deploy/.env` (a re-seed overwrites seeded rows
   that staff edited in Directus, recipes included).
2. Open `https://ADMIN_DOMAIN`, sign in with `DIRECTUS_ADMIN_EMAIL`/`PASSWORD`,
   change the password (and mirror it in `.env`). Directus 12 then asks for a
   license key and for a **project owner** who accepts its MSCL-1.0-GPL license
   and data processing agreement. That is a licensing decision for the project
   owner to make; "Skip" / "Remind later" defer it without accepting anything.
3. Check `https://APP_DOMAIN` (sign-up page) and the backend log line
   `codemare-backend: isolate 2.7 ready …` followed by `Sandbox: isolate`.
4. Run a backup by hand: `docker compose --env-file deploy/.env -f docker-compose.prod.yml exec backup codemare-backup`.

Shorthand used below: `alias dc='docker compose --env-file deploy/.env -f docker-compose.prod.yml'`.

## 6. Updates and rollbacks

```bash
git pull
deploy/deploy.sh               # build <sha>, pre-deploy backup, migrate, restart, health-wait
deploy/deploy.sh status        # current tag, health, available image tags
deploy/deploy.sh rollback <previous-sha>
```

`migrate` runs `prisma migrate deploy` on every start (idempotent; migrations
are forward-only). **Rollback caveat:** switching images back does not undo
migrations. That is safe when the migrations in between were additive (new
tables/columns the old code ignores). When they were not, restore the
pre-deploy backup instead (section 8.4) and then roll back.

Old images: `docker image ls 'codemare/*'`; remove tags you no longer need with
`docker image rm codemare/{web,backend,directus,backup}:<sha>`.

## 7. Directus

### 7.1 How Directus and Prisma share the database

Prisma migrations own all DDL for `app.*` and `content.*`. Directus edits rows
in `content.*` and must never create or alter those tables, and its own
`directus_*` tables must not break `prisma migrate`. The approach:

* **Directus' tables live in their own schema, `directus`.** `DB_SEARCH_PATH=directus,content`:
  Directus creates its system tables in the first schema of the path and
  introspects both (Directus 12's schema inspector reads every schema in the
  search path; table names do not collide). Prisma's datasource lists only
  `app` and `content` and keeps `_prisma_migrations` in `public`, so it never
  sees a `directus_*` table: `migrate dev`, `migrate diff` and drift detection
  are unaffected. (Directus in the default `public` schema would work for
  Prisma too, but mixes its 30+ tables with Prisma's ledger; putting them in
  `content` would make every `migrate dev` see drift and offer to drop them.)
* **Postgres enforces the boundary, not convention.** Directus connects as
  role `directus` (`deploy/postgres/db-init.sql`): owner of the `directus`
  schema; `SELECT/INSERT/UPDATE/DELETE` on `content.*` (default privileges cover
  tables later migrations add); no `CREATE` on `content`, owner of nothing in
  it, and no access to `app.*` or `public` at all. A data-model change attempted
  in Directus fails with `must be owner of table …`; `app.*` is invisible
  (`permission denied for schema app`).
* **The Directus configuration is code.** `admin/content-model/model.ts`
  (collections, field interfaces, relations, folders, the Content Editor role)
  is applied by the `directus-config` one-shot through the REST API. It only
  ever sends `meta`, never `schema`, so it cannot issue DDL, and re-running it
  changes nothing. Enum dropdown values are read from `web/prisma/schema.prisma`.
  A Directus schema *snapshot* (`directus schema apply`) was rejected: applying
  a snapshot diffs table definitions and would try to revert (or drop) columns
  that newer Prisma migrations added.

Verified locally on a scratch database (migrated + seeded): after Directus
bootstrapped, the content model was applied and recipes were edited through the
UI and the API, `prisma migrate status` reported *up to date*,
`prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --exit-code`
reported *no difference*, and a `pg_dump --schema-only` of app/content/public
was identical to that of a database migrated without Directus (grants included).

### 7.2 Admin bootstrap and users

* The first boot creates the admin user from `DIRECTUS_ADMIN_EMAIL` /
  `DIRECTUS_ADMIN_PASSWORD` (only while the `directus` schema is empty).
* Staff: *User Directory → Create user* with role **Content Editor** (CRUD on
  every content collection, no settings/data-model access). Invitations need
  Directus mail settings (`EMAIL_*`), which are not configured here.
* Optional: restrict the admin domain to office/VPN addresses in the Caddyfile.

### 7.3 Editing content

* **Recipe editor** (module bar, lock icon; `/admin/recipe-editor`): pick a topic,
  add/remove/reorder recipes, edit items (token topic, quantity, min difficulty).
  It blocks quantities < 1, unknown topics, items that spend the topic's own
  tokens, untitled/empty recipes, a tier ≥ 1 topic without recipes, and changes
  that would leave any topic impossible to unlock (the seed validator's rules),
  and it warns about duplicate token topics, higher-tier tokens and recipes
  the published content cannot pay for. The preview shows each recipe's token
  total, the recipe a new learner is pointed at ("cheapest") and how many
  qualifying tokens all published content pays out. A save is one nested write,
  applied in a single transaction.
* The extension also: gives rows created in Directus Prisma-style cuid ids
  (content ids have no database default), stores Postgres arrays (tags,
  companies, languages, slugs lists) correctly, bumps `questions.updated_at`,
  and re-checks the recipe rules server-side for any client.
* **Not editable in Directus:** `question_topics`, `gate_questions` and
  `component_deps` have composite primary keys, which Directus ignores. Edit them
  through the seed files or the web authoring UI. `questions.author_id` points
  into `app.users`, which Directus cannot read, so it is hidden.
* After a migration adds a content column, `directus-config` logs
  `column content.x.y is not in admin/content-model/model.ts` — add it there.
* The seed is a bootstrap tool: once staff edit content in Directus, the
  database is the source of truth. Do not re-run the seed on production unless
  you mean to reset the seeded rows.

### 7.4 Developing the extension

```bash
npm --prefix admin ci
npm --prefix admin test && npm --prefix admin run typecheck
npm --prefix admin run dev:extension     # rebuilds admin/extensions/codemare/dist
docker compose up -d --build             # local postgres :5433 + directus :8055 (admin@example.com / codemare-admin-dev)
```

## 8. Backups

### 8.1 Design and setup

Nightly at `BACKUP_AT` (UTC) the `backup` service runs `codemare-backup`:

1. `pg_dump -Fc` of the **whole database** as the read-only `codemare_backup`
   role: `app` and `content`, `public._prisma_migrations` (a restored database
   must be migratable forward) and `directus` (users, roles, content model).
   Written uncompressed so restic can deduplicate night over night; verified
   with `pg_restore --list`; a manifest records row counts and applied migrations.
2. `restic backup` to the Storage Box over SFTP, `restic forget --prune`
   (14 daily / 8 weekly / 6 monthly by default), `restic check` (a 5 % data
   sample on Sundays).
3. Success is recorded for the container healthcheck (unhealthy after 26 h
   without one) and `BACKUP_PING_URL` is pinged (`/start`, success, `/fail`).

Why restic rather than rsync of dump files: the dumps contain e-mail addresses
and password hashes and the Storage Box is off-site storage, so they are
encrypted before they leave the VPS; restic also implements the retention
policy, verifies the repository and deduplicates, none of which rsync does.

Setup, once:

```bash
# Hetzner console: Storage Box → enable "SSH support"; optionally a sub-account
# for this server, and automatic snapshots (daily, keep 7+). Box snapshots
# protect backups even if the VPS is compromised and deletes its restic data.
ssh-keygen -t ed25519 -N '' -C codemare-backup -f deploy/secrets/storagebox_ed25519
cat deploy/secrets/storagebox_ed25519.pub | ssh -p23 uXXXXX@uXXXXX.your-storagebox.de install-ssh-key
ssh-keyscan -p 23 uXXXXX.your-storagebox.de > deploy/secrets/storagebox_known_hosts
ssh-keygen -lf deploy/secrets/storagebox_known_hosts   # compare with Hetzner's published fingerprints
chmod 600 deploy/secrets/*
```

`deploy/.env`: `BACKUP_SSH_HOST/USER/PORT=23`, `RESTIC_REPOSITORY=sftp:uXXXXX@uXXXXX.your-storagebox.de:codemare-restic`,
`RESTIC_PASSWORD` (stored off the server too). The first run initializes the repository.

### 8.2 Everyday commands

```bash
dc exec backup codemare-backup            # back up now
dc exec backup codemare-restore snapshots # list snapshots
dc logs --tail 100 backup                 # last runs
```

### 8.3 Restore drill (monthly, and after changing anything backup-related)

Restores the latest snapshot into a scratch database next to production and
checks it; production is not touched.

```bash
set -a; . deploy/.env; set +a
dc run --rm -e PGUSER=postgres -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE=postgres \
   backup codemare-restore restore codemare_restore_drill latest --replace
#  → "comparing row counts with the manifest" … "restore of codemare_restore_drill complete"
dc run --rm -e MIGRATE_ON_START=false \
   -e DATABASE_URL="postgresql://codemare:$CODEMARE_DB_PASSWORD@postgres:5432/codemare_restore_drill" \
   migrate node node_modules/prisma/build/index.js migrate status --schema prisma/schema.prisma
#  → "Database schema is up to date!"
dc exec postgres psql -U postgres -c 'DROP DATABASE codemare_restore_drill'
```

Record the date and the snapshot restored. Locally this exact sequence restored
the snapshot through a real SFTP server, the row counts matched the manifest,
Prisma reported the restored database up to date, and a recipe edited through
Directus minutes earlier was present.

### 8.4 Restoring production

Replace the live database (bad deploy, data loss):

```bash
set -a; . deploy/.env; set +a
dc stop web directus backup
dc run --rm -e PGUSER=postgres -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE=postgres \
   backup codemare-restore restore "$CODEMARE_DB" <snapshot-id|latest> --replace
dc up -d
```

New server (disaster recovery): provision (sections 2–4) with the **same**
`deploy/.env` (same `RESTIC_PASSWORD`) and storage-box key, then
`dc up -d postgres db-init`, run the restore above, and `deploy/deploy.sh`.
`codemare-restore fetch <snapshot> /backups/restore` only downloads a dump
(e.g. to inspect it with `pg_restore -l`).

## 9. Monitoring and logs

* `dc ps` — every long-running service has a healthcheck (web: `/api/auth/providers`,
  backend: `/health`, directus: `/server/ping`, postgres: `pg_isready`, caddy:
  admin API, backup: last success < 26 h).
* `dc logs -f web backend directus caddy` — JSON-file logs, rotated at 20 MB × 5
  per container; caddy logs requests as JSON.
* External checks worth adding: an uptime monitor on `https://APP_DOMAIN/api/auth/providers`
  and `https://ADMIN_DOMAIN/server/ping`, and `BACKUP_PING_URL` on a dead man's
  switch (healthchecks.io or similar) so a missed backup pages someone.
* Capacity: `docker stats`, `df -h`, `docker system df`; Hetzner's graphs for CPU steal.

## 10. The sandbox: isolate, cgroups and `privileged`

The compile service runs untrusted code in [isolate](https://github.com/ioi/isolate)
2.7 (built from a checksum-pinned source tarball; it is not in Debian's archive).

**Host requirements:** cgroup v2 (`stat -fc %T /sys/fs/cgroup` = `cgroup2fs`),
Linux ≥ 5.19 (memory peak reporting), Docker with private cgroup namespaces
(the default on cgroup v2; the compose file sets `cgroup: private`).

**Why `privileged: true`:** for every box isolate creates mount, PID, network,
IPC and UTS namespaces, bind-mounts the toolchain directories read-only, and
writes the box's cgroup (`memory.max`, `cpuset.cpus`, `cgroup.kill`). A
default container has `/sys/fs/cgroup` read-only and lacks `CAP_SYS_ADMIN`
and the other capabilities that needs; granting them piecemeal (plus a custom
seccomp/AppArmor profile) is possible but brittle, so the container is
privileged and hardened around it instead: it has no published port and no
internet route (internal network), requires `INTERNAL_TOKEN`, and the server
runs as uid 10001 — only the setuid isolate binary is root, as on the old
systemd host. A privileged container is root-equivalent if it is escaped:
keep the host dedicated to Codemare.

**What the entrypoint does** (`deploy/backend/docker-entrypoint.sh`), each start:

1. Moves the container's processes into `/sys/fs/cgroup/init` (cgroup v2 lets
   only an empty cgroup delegate controllers), enables `cpuset memory pids`, and
   creates `/sys/fs/cgroup/isolate` as isolate's `cg_root` — the job
   `isolate.service` does on a systemd host.
2. Writes `/usr/local/etc/isolate`: box root, uid range 60000+, 1000 boxes,
   `syscall_flags`, and one CPU per box (`box N → CPU N mod ncpu`).
   isolate pins only through per-box cpusets in its config; it has no flag for
   it (its `--core` is the core-dump size). `ISOLATE_CPU_PINNING=off` disables it.
3. Initialises, runs and cleans up one box as the service user; if the host
   cannot sandbox, the container exits here with the reason.

**`ISOLATE_SYSCALL_FLAGS` (default 65531).** isolate ≥ 2.4 filters a few
syscalls that could leak data between concurrent boxes; flag 4 blocks file
locks, and `go build` takes `flock()`s on its build cache and exits 1 without
them. The default keeps every other restriction. Set `65535` once the compile
service passes `--syscalls` to Go compile boxes only.

**Toolchains in a box:** a box sees only `/usr`, `/bin`, `/lib*`, `/dev`,
`/proc` and a private `/tmp`, with an empty environment, so every compiler and
runtime is linked into `/usr/bin` directly (Node 20, python3, Temurin JDK 21,
Go, g++). `/usr/bin/g++` is a small shim (`deploy/backend/gxx-wrapper.sh`)
because without `PATH` GCC resolves itself as `/bin/g++` in a box and then
cannot find its C++ headers or `ld`.

**Development machines:** Docker Desktop (macOS/Windows) runs a Linux VM with
cgroup v2, and the same image works there privileged (verified on Apple
silicon). Without cgroup v2 delegation, run the backend with
`SANDBOX_MODE=local` and `NODE_ENV=development` (unsandboxed; the server
refuses local mode in production).

## 11. Local development and verification

```bash
docker compose up -d --build                 # postgres 127.0.0.1:5433, directus http://localhost:8055
docker compose --profile app up -d --build   # + web :3000, backend :4100
docker compose down -v                       # remove everything, data included
```

The production file can be exercised locally with a scratch env file whose
`APP_DOMAIN`/`ADMIN_DOMAIN` are `*.localhost` (Caddy then uses its internal CA),
`HTTP_PORT`/`HTTPS_PORT` set to free ports, and an SFTP container standing in
for the Storage Box; that is how this setup was verified end to end. The
browser specs run against the dev stack as well, e.g.
`cd web && PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test e2e/editor.spec.ts e2e/ide.spec.ts`
(sign-up → run → submit → Accepted, Go and C++ through isolate).

## 12. Troubleshooting

| symptom | cause / fix |
|---|---|
| backend exits: `is not a cgroup v2 mount` / `read-only` | host on cgroup v1, or container not privileged |
| backend log `Unavailable: cpp …` / `go …` | see section 10; the probe message has the compiler's error |
| `migrate` exited 1 | `dc logs migrate`; web and Directus wait for it |
| directus-config warns about unknown columns | update `admin/content-model/model.ts` after a migration |
| Directus: `must be owner of table` | someone tried a data-model change; do it as a Prisma migration |
| caddy: certificate errors | DNS not pointing at the VPS yet, or 80/443 blocked |
| backup unhealthy | `dc logs backup`; SSH key/known_hosts, `RESTIC_PASSWORD`, storage box quota |
