# Codemare

A DSA practice and learning platform. Learners solve problems in an in-browser
editor, their code is judged in a sandbox with **microsecond CPU timing**, and
they progress through a **tiered learning loop**: solving earns topic tokens,
tokens unlock new topics through recipes, and gate exams open each tier. Dark
first, with a light theme.

## What's in it

- **Practice** — a catalog of 30 problems (`/problems`) with URL-driven
  filters, and an editor workspace (`/problems/[slug]`) in **Python,
  JavaScript, TypeScript, C++, Java and Go**. Runs and submissions stream live
  over SSE (queued → compiling → running → each test → verdict) into a results
  hero with runtime in µs, memory, a "beats N%" percentile, and a per-test
  breakdown that explains failures. A free-form `/ide` with custom stdin.
- **The learning loop** — `/map` shows three tiers and ten topics with token
  balances, unlock recipes and "what's blocking you"; unlocking spends tokens
  from an append-only ledger that can never go negative. Gate exams
  (`/map/gates/…`) open each tier, with cooldowns. `/queue` walks predict →
  build steps that make learners write reusable components in dependency
  order; `/me/library` shows what they've built. A five-level hint ladder
  (nudge → solution) shows each hint's cost before it's revealed.
- **Learn** — three tracks of original lessons (`/learn`) with runnable code,
  step-through visualizations, callouts, formulas and checkpoint quizzes.
- **Profile and badges** — `/u/[handle]` with stats, a year of activity and
  17 badges.
- **Authoring** — `/author` for authors and staff, with a publish checklist
  that re-runs every reference solution through the judge.
- **Algorithms library** — `/library`, deliberately hidden (staff-only unless
  `FEATURE_LIBRARY_PUBLIC=true`, `noindex`, disallowed in `robots.txt`).
- **Admin** — Directus over the `content` schema, with a custom recipe-editor
  module, confined by Postgres roles to editing rows.
- **Optional AI review** of accepted submissions (`FEATURE_AI_REVIEW`), never
  in place of the tests.

## Architecture

```
browser ── Caddy (TLS) ──▶ web: Next.js 15 App Router ─────────────▶ Postgres 16
                            RSC pages, server actions,                ├ content.*  (problems, topics,
                            /api/run · /api/submit · /api/build       │             recipes, lessons…)
                            (SSE), Auth.js, Prisma                    └ app.*      (users, token ledger,
                                  │                                                submissions, progress…)
                                  │ X-Codemare-Token                        ▲
                                  ▼                                         │ rows only (Postgres roles)
                          compile service (backend/)                  Directus ─ admin.<domain>
                          /v1/run (+SSE), /v1/ide/execute
                          isolate sandbox · CPU-clock µs timing
                          no network · per-box memory/PID caps
```

- **`web/`** owns all user state and content (Prisma, two Postgres schemas,
  real migrations). Only its server code writes `app.*`.
- **`backend/`** is a stateless executor: the caller sends code plus tests,
  it compiles and runs them in `isolate` and returns per-test results. On a
  machine without isolate (e.g. macOS) it falls back to an unsandboxed local
  adapter for development, and refuses to do so in production.
- Everything runs on one VPS with Docker Compose, with nightly encrypted
  backups to a Storage Box — see [`deploy/README.md`](deploy/README.md).

## Repository layout

```
web/                Next.js app
  app/(workspace)/  every page (problems, ide, submissions, learn, map, queue,
                    me/library, u/[handle], author, library, sign-in pages)
  app/api/          run · submit · build (SSE), hints, ai-review, auth
  components/       ui/ (design system), states/, and one folder per feature
  lib/server/       domain layer: ledger, recipes, unlocks, gates, hints,
                    badges, runner… (unit-tested)
  prisma/           schema, migrations, seed (data/ = all content as JSON)
  e2e/              Playwright specs
backend/            compile service (Express + isolate), node:test suite
admin/              Directus content model as code + extensions
deploy/             Compose runtime config, backups, runbook
docs/spec/          architecture.md (the source of truth) + the product brief
```

## Running it locally

Prerequisites: Node 20+, Postgres 16+, and — to judge every language — Python 3,
a JDK (21), g++ and Go 1.22+.

```bash
npm install
npm run setup          # creates web/.env.local (with a fresh AUTH_SECRET)
createdb codemare      # then set DATABASE_URL in web/.env.local to point at it
npm run setup          # again: Prisma client, migrations, seed
npm run dev            # compile service :4000 + web :4001
```

Open http://localhost:4001 and create an account. `npm run setup` is safe to
re-run; `/dev/system` shows the whole design system in both themes.

## Tests

```bash
npm test -w backend                     # compile service (node:test)
npm test -w web                         # domain layer, seed, parsers (vitest)
npm run typecheck && npm run lint -w web

# End to end: against any running build of the app
cd web && PLAYWRIGHT_BASE_URL=http://localhost:4001 npx playwright test
```

CI runs all of it on every push: backend tests, a six-language judge smoke,
the isolate smoke inside the production image, the Compose and Directus admin
checks, web migrations/seed/unit tests/build, and the full Playwright suite —
accessibility gate included — against a production build. To build for
production next to a running dev server, use
`NEXT_DIST_DIR=.next-prod npm run build -w web` so the two don't share `.next`
(that build rewrites `web/next-env.d.ts` and `web/tsconfig.json`; restore them
with `git checkout` afterwards).

## Documentation

- [`docs/spec/architecture.md`](docs/spec/architecture.md) — data model,
  learning-loop rules, the runner and SSE protocol, routes, design language,
  environment. Build against this.
- [`docs/spec/implementation-prompt.md`](docs/spec/implementation-prompt.md) —
  the product brief.
- [`deploy/README.md`](deploy/README.md) — deployment, backups, Directus.
- [`docs/DECISIONS.html`](docs/DECISIONS.html) and
  [`docs/REPO-GUIDE.html`](docs/REPO-GUIDE.html) — decision records and an
  interactive repo tour (open in a browser).

## Known gaps

- The design project's artboards and `MVP Architecture.html` haven't been
  synced into the repo yet (`/design-sync`); the spec in `docs/spec/` is the
  working reconstruction, and screens follow the existing design system. When
  the files arrive, reconcile against them.
- Directus asks for a project owner to accept its license on first admin
  login — a decision for the deployment's owner.

## License

MIT.
