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

## Quick start

**Compile service (on a Linux VM):**

```bash
sudo bash deploy/install.sh        # installs isolate + runtimes, generates INTERNAL_TOKEN
deploy/release.sh user@your-vm     # build locally + rsync + systemctl restart
```

**Web app (anywhere):**

```bash
cd web
cp .env.example .env.local
# Set COMPILE_SERVICE_URL + INTERNAL_TOKEN (match the value in /etc/codemare/env)
# Set DATABASE_URL, AUTH_SECRET, AUTH_GITHUB_* / AUTH_GOOGLE_*
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev                        # http://localhost:3001
```

## API contract

The compile service is internal; only the Next.js server should call it.
Every authed endpoint requires `X-Codemare-Token` (timing-safe compared
against `INTERNAL_TOKEN`).

```
GET  /health                          → open
POST /v1/execute                      → ExecutionResponse (Problems mode)
POST /v1/ide/execute                  → IdeExecutionResponse (IDE mode)
GET  /v1/problems                     → ProblemListItem[]
GET  /v1/problems/:id                 → Problem
```

`/api/*` is kept as a legacy alias for one release while the Vite SPA is
retired.

## What's done

- Backend: Docker → isolate migration; per-language pid caps; single-core
  pinning; algorithm-only timing for Python and JS; internal-auth lockdown;
  systemd + install.sh deploy story; 12/12 unit tests.
- Web: full design-language port; catalog + problem detail + Monaco editor
  + Results panel; IDE mode + stdin/stdout test cases; design system page;
  auth page with OAuth wired; Prisma schema + submission persistence;
  submissions history + profile page.

## What's parked

- Per-problem C++/Java harness templates (the `Problem.harnessTemplate`
  field exists in Prisma; logic lands when the catalog migrates into the DB).
- Email/password Credentials provider (needs bcrypt + sign-up route).
- Learn section (tracks / modules / lessons / quizzes / runnable code blocks).
- Migrating the problem catalog from compile-service JSON into Postgres.
- Multi-iteration median for sub-millisecond timing on tiny algorithms.

## License

MIT.
