# Codemare web

The user-facing app: Next.js 15 (App Router), TypeScript, Tailwind v3, Auth.js
v5, Prisma 5, Monaco editor. Talks to the compile service over HTTPS with
`X-Codemare-Token`.

## Architecture

```
Browser ──▶ Next.js (this app)  ──HTTPS+token──▶  Compile service (backend/)
              │                                          │
              ├── App Router pages + server actions       └── isolate sandbox
              ├── Auth.js (GitHub / Google + Prisma)
              └── Postgres (User, Submission, Problem)
```

The browser never carries the compile-service token. Every call to
`/v1/execute` is server-side, attached by `lib/compile.ts`.

## Local dev

```bash
cd web
cp .env.example .env.local
# Fill in DATABASE_URL, AUTH_SECRET, AUTH_GITHUB_*, COMPILE_SERVICE_URL, INTERNAL_TOKEN
npm install
npx prisma generate
npx prisma migrate dev --name init  # only after setting DATABASE_URL
npm run dev                          # http://localhost:3001
```

For the compile service to respond, run a Linux box with `deploy/install.sh`
from this repo's root, copy `INTERNAL_TOKEN` from `/etc/codemare/env` to your
`.env.local`, and point `COMPILE_SERVICE_URL` at it.

## Routes

| Path | Server / client | Notes |
|---|---|---|
| `/` | server | Problem catalog. Fetches list from compile service. |
| `/p/[id]` | server + client | Problem detail; editor / IDE workspace. |
| `/ide` | client | Free-form IDE with stdin/stdout test cases. |
| `/design-system` | server (with client section state) | Full kit page. |
| `/auth` | client | Sign-in / sign-up / forgot password. OAuth wired. |
| `/submissions` | server | Personal history (requires auth). |
| `/profile` | server | Stats + sign-out (requires auth). |

`/learn/*` is the planned next section — not built yet.

## Directory map

```
app/
  layout.tsx                   # root <html>/<body>, fonts, SessionProvider
  globals.css                  # design tokens, font vars, base classes
  (workspace)/                 # route group sharing the navbar layout
    layout.tsx                 # reads session, renders <Navbar />
    page.tsx                   # catalog
    p/[id]/
      page.tsx                 # problem detail
      actions.ts               # runSolution server action + DB persist
    ide/
      page.tsx
      actions.ts               # runIdeCode server action
    submissions/page.tsx
    profile/page.tsx
    design-system/page.tsx
    auth/page.tsx
  api/auth/[...nextauth]/route.ts

components/
  ui/                          # design-system primitives, one per file
  Layout/Navbar.tsx
  Auth/                        # AuthPage, AuthForm, AuthBrandPanel, FormField, SessionProvider
  Catalog/CatalogList.tsx
  Problem/                     # ProblemDescription, ProblemExamples
  Editor/                      # CodeEditor (Monaco), LanguageSelector, EditorWorkspace
  Results/                     # OutputDisplay, TestCaseResults
  IDE/                         # IdeView, IdeOutputDisplay, TestCaseManager
  DesignSystem/                # DesignSystemPage + sections/

lib/
  types.ts                     # shared TS types (mirror compile-service shapes)
  compile.ts                   # server-only HTTP client (attaches X-Codemare-Token)
  prisma.ts                    # PrismaClient singleton

prisma/
  schema.prisma                # Identity + Problem + Submission tables

auth.ts                        # NextAuth config (GitHub + Google + PrismaAdapter)
middleware.ts                  # gates /submissions and /profile
```

## What's done vs. parked

Done:
- Full design-language port from the Vite frontend (tokens, primitives, screens)
- Problem catalog + detail + Monaco editor + Results panel
- IDE mode + stdin/stdout test cases
- Design system page with dark/light toggle
- Auth page with GitHub / Google OAuth wired
- Prisma schema + submission persistence on successful runs
- Submissions history page (last 100, table)
- Profile page (identity card, stats, by-difficulty)

Parked for follow-ups:
- Email/password Credentials provider (needs bcrypt + sign-up endpoint)
- Migrating the problem catalog from compile-service JSON into the DB
- Per-problem C++/Java harness templates (Problem.harnessTemplate field exists)
- Learn section (tracks / modules / lessons / runnable code blocks / quizzes)
- Retiring `frontend/` once this app is at parity in staging
