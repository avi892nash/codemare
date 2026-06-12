# Codemare

A µs-precision online judge for DSA practice. Multi-language (Python,
JavaScript, C++, Java), with **algorithm-only timing** — `runMs` reflects the
user function in microseconds, not interpreter startup or sandbox overhead.

## Architecture

```
┌─────────────────────────────────────┐         ┌────────────────────────────────┐
│  web/  — Next.js 15 (App Router)    │         │  backend/  — Compile service   │
│  ──────────────────────────────     │  HTTPS  │  ────────────────────────      │
│  · React pages + server actions     │ ──────▶ │  POST /v1/execute              │
│  · Tailwind + design tokens         │  X-     │  POST /v1/ide/execute          │
│  · Auth.js (GitHub / Google)        │  Code-  │  Returns SandboxResult         │
│  · Prisma → Postgres                │  mare-  │  isolate sandbox (Linux only)  │
│    (User · Submission · Problem)    │  Token  │  No DB · no auth state         │
│  · Monaco editor                    │ ──────▶ │  Stateless, horiz. scalable    │
└─────────────────────────────────────┘         └────────────────────────────────┘
```

Two services, one shared secret. The compile service is a thin black box that
takes `(language, code, input)` and returns timing + memory + status. The
Next.js app holds all user state (auth, submissions, profile) and never
exposes the compile-service token to the browser.

The legacy Vite SPA in `frontend/` is **retired** in favour of `web/` — kept
in the tree for one cycle as a reference; will be deleted once `web/` is at
parity in staging.

## Key features

- **Algorithm-only timing.** Wrappers in the compile service measure each
  user-function call with `time.perf_counter_ns()` (Python) or
  `process.hrtime.bigint()` (JS), so `runMs` is microseconds-precision and
  excludes interpreter cold-start. `wallMs` is kept as a separate diagnostic.
- **Single-core CPU pinning.** Every run box is bound to one host core
  (`--core=N` round-robin by box id) so user code can't parallelise the
  algorithm to win timing comparisons unfairly — CP-judge convention.
- **Per-language pid caps.** C++/Python: 1. JavaScript: 16. Java: 64. Tight
  enough to block user-spawned thread pools, loose enough for the runtime
  itself (JVM internals etc.) to boot.
- **Two-phase compile / run** for C++ and Java. `compileMs` and `runMs` are
  tracked separately so compile time never counts against the user's budget.
- **CP fairness defaults.** 10 s CPU, 256 MB memory, 50 PIDs, no network,
  empty filesystem, fresh namespace stack per submission.

## Languages

Python · JavaScript · C++ · Java. Adding a language is ~10 lines in
[`backend/src/services/sandbox/languageSpec.ts`](backend/src/services/sandbox/languageSpec.ts)
plus an `apt-get install` in `deploy/install.sh`.

C++ and Java Problems mode currently emits a "not yet implemented" verdict —
per-problem harness templates land alongside the catalog migration into
Postgres. IDE mode works fully for all four languages.

## Layout

```
backend/        Compile service (Express + isolate)
  src/
    services/sandbox/   types, languageSpec, metaParser, boxPool, isolateAdapter
    services/           executionService, ideExecutionService, codeWrapperService
    middleware/         internalAuth, errorHandler, rateLimit
    routes/             problemRoutes, executionRoutes, ideRoutes
    config/sandbox.ts   limits, isolate config
  tests/sandbox/        metaParser + boxPool unit tests
  DEPLOYMENT.md         systemd + install.sh guide

web/            Next.js app — user-facing
  app/(workspace)/      catalog · problem detail · ide · design-system · auth · submissions · profile
  components/           ui · Catalog · Problem · Editor · Results · IDE · DesignSystem · Auth · Layout
  lib/                  compile.ts (server-only HTTP client), prisma.ts, types.ts
  prisma/schema.prisma  User, Account, Session, Problem, Submission
  auth.ts               NextAuth (GitHub + Google + PrismaAdapter)
  middleware.ts         Gates /submissions and /profile
  README.md             Detailed dev guide

deploy/         Linux VM provisioning for the compile service
  install.sh            apt-get isolate + node + python3 + jdk + g++; generates INTERNAL_TOKEN
  release.sh            build locally, rsync to VM, systemctl restart
  codemare-backend.service

frontend/       LEGACY Vite SPA. Retire once web/ is at parity in staging.
```

## Quick start — local dev (macOS, Linux, anywhere)

```bash
git clone https://github.com/avi892nash/codemare.git
cd codemare
npm install              # installs backend/ and web/ via workspaces
npm run setup            # web/.env.local + Prisma client + (DB seed if configured)
npm run dev              # starts both services
```

`npm run setup` is idempotent — safe to re-run. It writes `web/.env.local`
with a fresh `AUTH_SECRET`, generates the Prisma client, and (if
`DATABASE_URL` points at a reachable Postgres) pushes the schema and seeds
**Two Sum** + **Reverse String** so the catalog has rows on first load.
Without a DB the app still works; submissions just don't persist.

Open `http://localhost:3001` for the web app. The backend boots on `:3000`.

On a host **without** `isolate` (typical dev: macOS, Windows, a Linux box
without isolate installed), the compile service starts in **`local`** mode:
user code runs via `child_process.spawn` with no isolation. A loud yellow
warning is printed on every boot so you don't mistake it for production
behaviour. The wrapper-level `runMs` / `memoryKb` numbers for Python and
JavaScript are still accurate — those are measured inside the user process.

On Linux **with** `isolate` installed (production), the backend
auto-detects it and uses it. No env var change needed. Set
`SANDBOX_MODE=isolate` if you want to be explicit, or
`NODE_ENV=production` to make missing isolate a hard failure.

## Quick start — production

```bash
# On a Linux VM (Ubuntu 22.04+ / Debian 12+)
sudo bash deploy/install.sh                       # installs isolate + runtimes, generates INTERNAL_TOKEN
deploy/release.sh user@your-vm                    # builds locally, rsyncs, systemctl restart

# Web app — Vercel or any Node host
cd web
# Vercel dashboard: set COMPILE_SERVICE_URL, INTERNAL_TOKEN (match /etc/codemare/env),
#                   DATABASE_URL (Neon / Supabase / RDS),
#                   AUTH_SECRET, AUTH_GITHUB_* / AUTH_GOOGLE_*
vercel --prod
```

## API contract

The compile service is internal; only the Next.js server should call it.
Every authed endpoint requires `X-Codemare-Token` (timing-safe compared
against `INTERNAL_TOKEN`).

```
GET  /health                          → open
GET  /v1/problems                     → ProblemListItem[]
GET  /v1/problems/:id                 → Problem
POST /v1/execute                      → ExecutionResponse, or { token } (202) if queued
POST /v1/ide/execute                  → IdeExecutionResponse, or { token } (202) if queued
GET  /v1/execute/:token               → poll a queued Problems submission
GET  /v1/ide/execute/:token           → poll a queued IDE submission
```

`POST /v1/execute?wait=true` forces the synchronous path. The async token
flow activates only when the compile service has `REDIS_URL` set; otherwise
every submit is synchronous. The web client handles both transparently.

`/api/*` is kept as a legacy alias for one release while the Vite SPA is
retired.

## What's done

- Backend: Docker → isolate migration; per-language pid caps; single-core
  pinning; algorithm-only timing for Python and JS; content-addressed compile
  cache (C++/Java re-runs skip compilation); parallel IDE test cases;
  internal-auth lockdown; optional Redis queue + worker pool for horizontal
  scale; systemd + install.sh deploy story; 21/21 unit tests.
- Web: full design-language port; catalog + problem detail + Monaco editor
  + Results panel; IDE mode + stdin/stdout test cases;
  email/password auth (bcrypt + sign-up) plus OAuth, login wall via
  middleware; Prisma schema + submission persistence; submissions history +
  profile page; transparent sync/async submission client.

## What's parked

- Per-problem C++/Java harness templates (the `Problem.harnessTemplate`
  field exists in Prisma; logic lands when the catalog migrates into the DB).
- Password reset / email verification (needs an email provider).
- Learn section (tracks / modules / lessons / quizzes / runnable code blocks).
- Migrating the problem catalog from compile-service JSON into Postgres.
- Multi-iteration median for sub-millisecond timing on tiny algorithms.
- Live-Redis integration test (the queue's gating is unit-tested; the
  enqueue→worker→poll path is verified manually against a real Redis).

## License

MIT.
