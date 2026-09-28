# Codemare web

The user-facing app: Next.js 15 (App Router) in TypeScript, Tailwind CSS 3,
Auth.js v5 (email and password, plus GitHub / Google when their keys are
set), Prisma 5 on Postgres, and the Monaco editor. It owns all user state and
content, and judges code by calling the compile service (`../backend`) from
server code only, with `X-Codemare-Token` (`lib/compile.ts`). The browser
never sees that token.

The product, data model and rules are specified in
[`docs/spec/architecture.md`](../docs/spec/architecture.md).

## Running it

Follow the quick start in the [root README](../README.md#running-it-locally).
From the repo root:

```bash
npm install
npm run setup          # creates web/.env.local (with a fresh AUTH_SECRET)
createdb codemare      # then set DATABASE_URL in web/.env.local to point at it
npm run setup          # again: Prisma client, migrations, seed
npm run dev            # compile service :4000 + web http://localhost:4001
```

`npm run setup` (`scripts/setup.mjs`) is safe to re-run. Without a real
`DATABASE_URL` it skips the migrations and the seed.

## Scripts

Run from `web/`, or from the root with `-w web` (e.g. `npm test -w web`).

| Script | Does |
|---|---|
| `dev` / `start` | `next dev` / `next start` on port 4001 |
| `build` | production build (`NEXT_DIST_DIR=.next-prod` keeps it apart from a running dev server's `.next`) |
| `lint`, `typecheck` | `next lint`, `tsc --noEmit` |
| `test`, `test:watch` | vitest unit tests (see below) |
| `test:e2e` | Playwright (see below) |
| `setup` | first-time setup, as above |
| `db:migrate`, `db:deploy`, `db:reset` | `prisma migrate dev` / `deploy` / `reset` |
| `seed` | load `prisma/seed/data` (upsert by slug; `--mode insert-missing` or `SEED_MODE` to only add new rows; `SEED_DIR` for another directory) |
| `seed:fixtures` | load the small fixture set in `prisma/seed/fixtures` |

The `db:*` and `seed*` scripts load `web/.env.local` themselves
(`prisma/with-env.mjs`), since Prisma's CLI only reads `.env`.

## Environment

Copy [`.env.example`](.env.example) to `.env.local` (`npm run setup` does it).
Server-side only; nothing here is `NEXT_PUBLIC_`.

- `DATABASE_URL`: Postgres; the app uses two schemas, `app` and `content`.
- `AUTH_SECRET`: Auth.js signing secret.
- `COMPILE_SERVICE_URL` (default `http://localhost:4000`) and
  `INTERNAL_TOKEN`: where the compile service is and the shared secret it
  expects. In production the compile client throws on load when the token
  is missing or still the placeholder.
- `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`, `AUTH_GOOGLE_ID` /
  `AUTH_GOOGLE_SECRET`: optional OAuth sign-in.

Optional settings (the public library flag, AI review, password-reset mail,
`AUTH_URL`) are in the spec's
[environment table](../docs/spec/architecture.md#9-environment).

## Where things live

```
app/
  (workspace)/     every page: problems, ide, submissions, learn, map, queue,
                   me/library, u/[handle], author, library, sign-in pages
  api/             run · submit · build (SSE), hints, ai-review, auth
  dev/system/      the design system in both themes (not in production)
components/        ui/ (design system), states/ (empty, loading, error
                   pages), one folder per feature
lib/
  compile.ts       server-only compile-service client (/v1/run, /v1/run/stream,
                   /v1/ide/execute)
  types.ts         shared domain types
  client/          browser-side helpers (run stream, drafts, formatting)
  server/          the domain layer: ledger, recipes and unlocks, gates,
                   hints, badges, the runner, authoring… (rules/ holds the
                   pure rule functions; test/ the DB test harness)
prisma/
  schema.prisma    the data model
  migrations/      applied with prisma migrate deploy
  seed/            loader and validation; data/ is all content as JSON,
                   fixtures/ a small set, verify/ Python checks of the content
                   (reference solutions, starters, the loop)
e2e/               Playwright specs
auth.ts            Auth.js (credentials + optional OAuth), JWT sessions
middleware.ts      route guards
```

## Tests

**Unit tests** (`npm test -w web`, vitest) cover `lib/**/*.test.ts` and
`prisma/**/*.test.ts`. The database tests truncate every table, so they run
against a database whose name must end in `_test`: `TEST_DATABASE_URL` if
set, otherwise `DATABASE_URL` (from the environment or `.env.local`) with the
database name swapped for `codemare_test`. The global setup creates that
database if needed and applies the migrations; test files run one at a time.

**End-to-end tests** (`npm run test:e2e -w web`, Playwright) drive an app
that is already running, with a seeded database and the compile service
behind it. `PLAYWRIGHT_BASE_URL` points them at it (default
`http://localhost:4001`):

```bash
cd web
npx playwright install chromium                                # once
PLAYWRIGHT_BASE_URL=http://localhost:4001 npx playwright test
```

CI runs both, the second against a production build.
