# Codemare — MVP architecture (working spec)

This is the single source of truth every part of the build follows. It
reconstructs the design project's `MVP Architecture.html`, which is not in the
repo yet (see `implementation-prompt.md`). When the design files arrive in
`/design`, reconcile against them — **the design files win on conflict**.

---

## 0. Decisions that differ from the implementation prompt

1. **Code execution = our compile service (`backend/`), not Judge0.** It
   already gives isolate sandboxing (no network, CPU/memory/PID caps, one core
   per box), CPU-clock µs timing, a content-addressed compile cache and an
   optional Redis queue. We extend it with a pure-executor contract (§5),
   SSE progress streaming, and TypeScript + Go.
2. **Design files absent → the existing design system is canonical.**
   `web/app/globals.css` (`.cm` dark default, `.cm-light` light) and
   `web/components/ui/*` were ported from this same design. New screens extend
   that language (§8). Never invent colors outside the tokens.
3. **ORM = Prisma** (already in use) with `previewFeatures = ["multiSchema"]`
   and real migrations (`prisma migrate`), not `db push`.
4. **Questions support all six languages.** *(Component builds — My Library,
   in python, javascript, typescript, cpp and go, never Java — were removed on
   2026-10-02 at the owner's request, together with the Queue; see decision
   38 in `docs/DECISIONS.html`.)*
5. **Lessons, checkpoints and the Library** need content tables the prompt's
   table list doesn't name; they're added below (`tracks`, `learn_modules`,
   `lessons`, `checkpoint_questions`, `library_*`) plus the app-side progress
   tables that go with them.

---

## 1. System overview

```
browser ──▶ web (Next.js 15 App Router, RSC-first)
              │  server actions + route handlers (/api/*)
              │  Prisma ──▶ Postgres  { content.*  app.* }
              │                          ▲
              │                  Directus (admin CMS over content.*)
              └──X-Codemare-Token──▶ backend (compile service, stateless)
                                        isolate sandbox (prod) / local adapter (dev)
```

- **web** owns all user state and all content reads/writes. Only web server
  code writes `app.*`.
- **backend** never touches the DB. The caller supplies code + tests.
- **Deploy**: one Hetzner VPS, Docker Compose (caddy, web, backend
  [privileged for isolate], postgres, directus, nightly backup).

---

## 2. Data model

Prisma conventions: model names PascalCase singular; tables snake_case plural
via `@@map`; columns snake_case via `@map`; every model has `@@schema("app")`
or `@@schema("content")`. IDs are `cuid()` strings except `token_ledger`
(bigserial). Timestamps `timestamptz`. Enums live in the schema that uses them.
Every `content` table has a single-column `id` primary key — Directus only
edits such tables — so the join tables carry a surrogate `id` and keep their
natural pair as a unique constraint. Content ids have no database default:
Prisma generates them, and Directus' content-integrity hook for rows created
there.

### Shared enums
- `Difficulty`: `Easy | Medium | Hard` (ordering Easy < Medium < Hard matters)
- `Language`: `python | javascript | typescript | cpp | java | go`
- `Role`: `learner | author | staff | admin` (ordered)
- `Verdict`: `OK | WA | TLE | MLE | RE | CE | XX`

### `content` schema (edited by staff via Directus; seeded by Prisma)

| table | columns |
|---|---|
| `tiers` | id, ord (int, unique; 0 = free tier), slug (unique), title, summary |
| `topics` | id, tier_id→tiers, slug (unique), title, summary, icon (IconName), ord |
| `unlock_recipes` | id, topic_id→topics, title, ord |
| `recipe_items` | id, recipe_id→unlock_recipes (cascade), token_topic_id→topics, quantity (int > 0), min_difficulty (Difficulty, default Easy) |
| `questions` | id, slug (unique), title, difficulty, statement_md, examples (json), constraints (json string[]), function_name, signature (json), compare_mode (`ordered`\|`unordered`), starter_code (json {Language: code}), tests (json TestDef[]), reference_solutions (json {Language: code}, **never sent to learners**), tags (text[]), companies (text[]), editorial_md (nullable), status (`draft`\|`published`, default published for seeded), author_id→app.users (nullable), time_limit_ms (default 2000), memory_limit_mb (default 256), created_at, updated_at |
| `question_topics` | id, question_id→questions (cascade), topic_id→topics, weight (float, > 0 by CHECK, default 1.0); unique (question_id, topic_id) |
| `hints` | id, question_id→questions (cascade), level (`nudge`\|`concept`\|`pseudo`\|`line`\|`solution`), body_md, cost_kind (`score`\|`token`), cost_amount (int ≥ 0, CHECK); unique (question_id, level) |
| `gates` | id, tier_id→tiers (unique: the tier this gate opens), title, summary, pass_threshold (int), cooldown_hours (int, 12–24), time_limit_minutes (default 60) |
| `gate_questions` | id, gate_id→gates (cascade), question_id→questions, ord; unique (gate_id, question_id) |
| `badges` | id, slug (unique), name, description, icon (IconName), rarity (`common`\|`rare`\|`epic`\|`legendary`), criteria (json, §3.7), ord |
| `tracks` | id, slug (unique), title, summary, level (`beginner`\|`intermediate`\|`advanced`), tier_id (nullable), est_hours, ord |
| `learn_modules` | id, track_id→tracks (cascade), slug, title, summary, ord; unique (track_id, slug) |
| `lessons` | id, module_id→learn_modules (cascade), slug, title, ord, body_md (§6.2), est_minutes, topic_id (nullable), related_question_slugs (text[]); unique (module_id, slug) |
| `checkpoint_questions` | id, module_id→learn_modules (cascade), ord, kind (`mcq`\|`short`), prompt_md, choices (json string[] nullable), answer (json), explanation_md |
| `library_areas` | id, slug (unique), title, summary, icon, ord |
| `library_chapters` | id, area_id→library_areas (cascade), slug, title, ord; unique (area_id, slug) |
| `library_articles` | id, chapter_id→library_chapters (cascade), slug (unique), title, summary, difficulty, reading_minutes, idea_md, formula (text nullable), code_cpp, viz_id (nullable), applications_md, pitfall_md, practice_question_slugs (text[]), status (`draft`\|`published`), ord |

*Removed 2026-10-02 at the owner's request, with the Queue (migration
`20261002000000_remove_queue`): `components`, `component_deps` and
`build_steps`, and hints on build steps.*

### `app` schema (written only by web server code)

| table | columns |
|---|---|
| `users` | id, email (unique), name, handle (unique, lowercase `[a-z0-9_]{3,24}`), image, password_hash (nullable), email_verified, role (Role, default learner), created_at, updated_at |
| `accounts`, `sessions`, `verification_tokens` | Auth.js adapter tables (model names `Account`/`Session`/`VerificationToken`, field names per `@auth/prisma-adapter`, columns mapped to snake_case). Password-reset tokens reuse `verification_tokens` with identifier `reset:<email>` |
| `token_ledger` | id (bigserial), user_id→users, topic_id→content.topics, amount (int ≠ 0), source_difficulty (Difficulty), reason (`solve`\|`build`\|`gate`\|`unlock`\|`hint`\|`admin`), ref_type (`question`\|`build_step`\|`recipe`\|`hint`\|`gate`\|`admin`), ref_id (text), created_at — `build` / `build_step` only on rows earned before the Queue was removed (nothing writes them now; they stay in balances). **Append-only**: a trigger raises on UPDATE/DELETE. Index (user_id, topic_id, source_difficulty). Partial unique index (user_id, reason, ref_type, ref_id, topic_id, source_difficulty) WHERE amount > 0 — makes earns idempotent |
| `unlocks` | id, user_id, kind (`topic`\|`tier`), ref_id, via_recipe_id (nullable), created_at; unique (user_id, kind, ref_id) |
| `submissions` | id, user_id, kind (`run`\|`submit`\|`gate`), question_id (nullable: null only once the question is deleted), gate_attempt_id (nullable), language, code, status (`queued`\|`running`\|Verdict), total_passed, total_tests, runtime_us (bigint, sum of per-test CPU µs), memory_kb (max per test), compile_ms, error, percentile (float nullable), created_at. Indexes (user_id, created_at), (question_id, language, status, runtime_us) |
| `test_results` | id, submission_id (cascade), idx, passed, hidden, runtime_us, memory_kb, input (json, null when hidden), expected (json, null when hidden), actual (json, null when hidden), error, explain_on_fail (text, only set when failed) |
| `hint_uses` | id, user_id, hint_id, question_id, cost_kind, cost_amount, created_at; unique (user_id, hint_id) |
| `gate_attempts` | id, user_id, gate_id, started_at, deadline_at, finished_at (nullable), passed_count, passed (nullable until finished), next_eligible_at (nullable) |
| `badge_awards` | id, user_id, badge_id, awarded_at; unique (user_id, badge_id) |
| `lesson_progress` | user_id, lesson_id, status (`started`\|`completed`), started_at, completed_at; PK both |
| `checkpoint_attempts` | id, user_id, module_id, score, total, passed, answers (json), created_at |
| `library_progress` | user_id, article_id, read_at; PK both |
| `ai_reviews` | id, submission_id (cascade), model, content_md, input_tokens, output_tokens, cache_read_tokens, created_at |

*Removed 2026-10-02 with the Queue: `component_versions`, `step_progress`,
build submissions (kind `build`) and the `build_step_id` columns.*

### 2.1 JSON shapes
```ts
type SignatureType = 'int'|'long'|'double'|'bool'|'string'|'char' | `${…}[]` | `${…}[][]`;
type Signature = { params: { name: string; type: SignatureType }[]; returns: SignatureType };
type TestDef = { input: unknown[]; expected: unknown; hidden: boolean; explain_on_fail?: string };
type Example = { input: string; output: string; explanation?: string };

// badges.criteria
type Criteria =
  | { kind: 'first_accept' } | { kind: 'solves'; n: number }
  | { kind: 'solves_difficulty'; difficulty: Difficulty; n: number }
  | { kind: 'streak_days'; n: number } | { kind: 'no_hint_solves'; n: number }
  | { kind: 'topics_unlocked'; n: number }
  | { kind: 'tier_open'; tier_ord: number } | { kind: 'gate_first_try' }
  | { kind: 'lessons_completed'; n: number } | { kind: 'track_completed' }
  | { kind: 'fast_solve'; percentile: number };
```

Language type mapping for typed harnesses (C++/Java already exist in `backend`):

| signature | TypeScript | Go |
|---|---|---|
| int, long, double | number | int, int64, float64 |
| bool / string / char | boolean / string / string | bool / string / byte |
| `T[]` / `T[][]` | `T[]` / `T[][]` | `[]T` / `[][]T` |

Starter-code conventions: every stub compiles verbatim (non-void stubs return a
zero value). Go stubs have **no** `package` clause and no imports (the harness
adds them). TypeScript stubs are typed function declarations.

---

## 3. Domain rules

All of this lives in `web/lib/server/` as plain functions over Prisma,
unit-tested. UI never re-implements a rule.

### 3.1 Balances
- Bucket balance = `SUM(amount)` over `(user_id, topic_id, source_difficulty)`.
- Topic balance = sum of its buckets. "Qualifying balance" for a recipe item =
  sum of buckets with difficulty ≥ `min_difficulty`.

### 3.2 Earning
- **First accepted `submit` of a question** (idempotent): for each
  `question_topics` row, `amount = round(BASE[difficulty] × weight × (1 − penalty/100))`,
  `BASE = {Easy: 1, Medium: 2, Hard: 3}`, `penalty` = sum of score-kind hint
  costs the user revealed on that question, capped at 100. Rows with
  amount ≤ 0 are skipped. `source_difficulty` = question difficulty,
  reason `solve`, ref (`question`, question_id). Composite questions (topics
  across tiers) are how higher-tier tokens enter — weights split the award.
- **Gate pass** awards no tokens; it opens the tier.
- Solving questions is the only way to earn. *(First passing builds of
  build steps paid too until the Queue was removed on 2026-10-02; those
  ledger rows stay.)*

### 3.3 Spending (never negative)
One transaction:
1. `SELECT pg_advisory_xact_lock(hashtextextended(<user_id>, 0))`
2. Read bucket balances for the user.
3. For each requirement `(topic, quantity, min_difficulty)`, debit qualifying
   buckets in **ascending** difficulty (Easy → Medium → Hard, skipping buckets
   below `min_difficulty`) — cheapest tokens go first — inserting one negative
   row per bucket touched, with that bucket's `source_difficulty`.
4. Any shortfall → throw `InsufficientTokens` (nothing written).

Used by recipe unlocks (reason `unlock`, ref `recipe`) and token-cost hints
(reason `hint`, ref `hint`).

### 3.4 Unlocks and access
- Tier with `ord = 0` is always open; its topics are always unlocked (no rows).
- Tier N > 0 is open iff the user has `unlocks(kind=tier, ref=tier_id)`,
  written when they pass that tier's gate.
- A topic in tier N > 0 unlocks when its tier is open **and** the user spends
  one of its recipes (any one) — `unlocks(kind=topic, via_recipe_id)`.
- **What's blocking you** for a locked topic: if its tier is closed → the gate
  is the blocker (with cooldown / eligibility). Otherwise for each recipe,
  `missing = Σ max(0, quantity − qualifying_balance)` per item; cheapest recipe
  = min `missing`, tie → min total quantity → `ord`. Return per-item
  `{topic, have, need, min_difficulty}`.
- A question is accessible iff **every** one of its topics is unlocked — or it
  belongs to a gate the user has a running attempt for (gate questions are
  always reachable during their attempt). Locked questions still list in the
  catalog, with a lock and a link to `/map`.

### 3.5 Gates
- Eligible for tier N's gate: tier N−1 open, no running attempt, and
  `now ≥ next_eligible_at` of the latest failed attempt.
- Start → `gate_attempts` row with `deadline_at = now + time_limit_minutes`.
  Learner submits gate questions (submissions kind `gate`, linked).
- Finish (explicit, or lazily when read after `deadline_at`):
  `passed_count` = gate questions with an accepted gate submission in the
  attempt; `passed = passed_count ≥ pass_threshold`. Pass → unlock tier.
  Fail → `next_eligible_at = finished_at + cooldown_hours`.

### 3.6 Hint ladder
- Order `nudge → concept → pseudo → line → solution`; a level is revealable
  only after all lower levels are revealed.
- The cost is shown **before** reveal; reveal needs explicit confirmation.
- `score` cost = percentage penalty on that question's future token award
  (defaults: nudge 0, concept 10, pseudo 25, line 40, solution 100).
  `token` cost = spend `cost_amount` tokens of the question's highest-weight
  topic via §3.3.
- Every first reveal writes `hint_uses`; re-viewing is free.

### 3.7 Badges
`evaluateBadges(userId)` runs after: accepted submit, unlock, gate finish,
lesson complete, checkpoint pass. Awards are idempotent.
Streaks count UTC days with ≥ 1 accepted submission.

### 3.8 Percentile
On an accepted submit: among accepted submits of the same question and
language (latest per user), percentile = % with `runtime_us` strictly greater
than this one. UI shows "Beats N%".

### 3.9 Roles and flags
- `learner < author < staff < admin`. Role rides in the JWT (set on sign-in).
- `/author/*` needs ≥ author. `/library/*` needs ≥ staff unless
  `FEATURE_LIBRARY_PUBLIC=true` — otherwise a plain 404. `/dev/*` exists only
  when `NODE_ENV !== 'production'`.
- Admin = Directus + staff routes.

### 3.10 AI review (optional, `FEATURE_AI_REVIEW=true` + `ANTHROPIC_API_KEY`)
- Only offered on accepted submissions — never replaces or gates tests.
- Default model `claude-haiku-4-5-20251001`; "Deeper review" escalates to
  `claude-sonnet-5`. Stable review instructions go first in the system prompt
  with `cache_control: {type: 'ephemeral'}`, then the problem, then the code.
- Stored in `app.ai_reviews` (with token usage).

---

## 4. Web API

| route | purpose |
|---|---|
| `POST /api/run` | run against visible tests or learner-supplied inputs; not persisted as a submit (kind `run`) |
| `POST /api/submit` | all tests incl. hidden; persists submission + test_results, awards tokens, badges, percentile |

*`POST /api/build` (a component build step, with the learner's dependencies
as prelude) was removed on 2026-10-02 at the owner's request, with the Queue.*

Both: session required, per-user rate limit (30/min, shared bucket),
source ≤ 64 KB, access check (§3.4), then call backend `/v1/run/stream` and
relay as SSE:

```
event: queued     data: {}
event: compiling  data: {}                        (compiled languages only)
event: running    data: {}
event: test       data: {idx, passed, hidden, runtimeUs, memoryKb,
                         input?, expected?, actual?, error?, explainOnFail?}
event: verdict    data: {status, totalPassed, totalTests, runtimeUs, memoryKb,
                         compileMs?, submissionId?, percentile?,
                         tokensAwarded?: {topic, amount}[], badgesAwarded?: {slug, name}[], error?}
event: error      data: {message}
```

Hidden tests never expose input/expected/actual. Verdict labels:
OK Accepted · WA Wrong Answer · TLE Time Limit Exceeded · MLE Memory Limit
Exceeded · RE Runtime Error · CE Compilation Error · XX Internal Error.

---

## 5. Backend (compile service) contract

- `POST /v1/run` → JSON result; `POST /v1/run/stream` → SSE (`queued`,
  `compiling`, `running`, `test`…, `verdict`). Body:
  ```ts
  { language: Language; code: string; prelude?: string[];
    functionName: string; signature?: Signature; compareMode?: 'ordered'|'unordered';
    tests: { input: unknown[]; expected: unknown; hidden?: boolean }[];
    limits?: { timeMs?: number; memoryMb?: number } }
  ```
  Per test: `passed, runUs (CPU µs), wallUs, memoryKb, actual, error`.
  Signature is required for cpp, java, go. `prelude` (sources placed before
  `code`, same language, never Java) is a generic executor feature; the web
  app has sent none since the Queue's builds were removed.
- `POST /v1/ide/execute` unchanged (plus typescript, go).
- TypeScript: transpiled to JS in the API process (transpile-only; syntax
  errors → CE), then run through the JavaScript harness.
- Go: compiled in the sandbox (`go build`), compile-cached, harness generated
  from the signature like C++/Java.
- The old `POST /v1/execute`, `GET /v1/problems*` and
  `backend/src/data/problems/` were removed once the web app moved to `/v1/run`.

---

## 6. Content

### 6.1 Seed data (`web/prisma/seed/data/`)
- `questions/<slug>.json` — one question each:
  `slug, title, difficulty, statement_md, examples, constraints, function_name,
  signature, compare_mode, starter_code{6 langs}, tests[TestDef],
  reference_solutions{python, javascript}, topics[{slug, weight}], tags,
  companies, editorial_md, hints[{level, body_md, cost_kind, cost_amount}]`
- `loop.json` — `tiers[]`, `topics[]`, `recipes[{topic, title, items[{topic,
  quantity, min_difficulty}]}]`, `gates[{tier, title, summary,
  pass_threshold, cooldown_hours, time_limit_minutes, questions[slug]}]`
  (its `components` were removed on 2026-10-02 with the Queue; the key is now
  rejected)
- `badges.json`, `learn/<track>.json`, `library/<area>.json`
- Runs with `npm run seed -w web` (`-- --mode <mode>`, or `SEED_MODE`); it
  validates every file first and writes nothing if any is invalid, then writes
  in one transaction. Two modes:
  - **`upsert`** (default for `npm run seed`, i.e. development): the files are
    the source of truth. Rows upsert by natural key (slug; module/lesson/chapter
    slug within its parent; hint level; recipe position); owned sets
    — question topics, gate questions (kept by their pair, so ids survive),
    recipe items, checkpoint questions — become exactly the files'; children
    the files dropped are deleted unless learners touched them (then kept,
    with a warning). Idempotent. Overwrites staff edits.
  - **`insert-missing`** (production; the web image's default, used by
    `SEED_ON_START`): the database is the source of truth. A row is created only
    when its natural key is absent — a tier, topic, question, badge, track or
    library area by slug, a gate by its tier — together with everything it
    owns (a topic's recipes and items; a question's topics, weights and
    hints; a gate's questions; a track's modules, lessons and checkpoints; an
    area's chapters and articles). An existing row is never updated or deleted, and
    nothing is added under it: new children of an existing parent (a new hint,
    lesson or gate question in the files) are not applied — make them in
    Directus. References from new rows resolve by slug to the rows that exist.
    Refused (nothing written): a new tier whose `ord` an existing tier holds.
    Skipped with a warning: a new area's article whose slug exists elsewhere.
    On an empty database it seeds exactly what `upsert` does. Since slugs are
    the identity, a seeded row deleted or re-slugged in Directus is created
    again on the next run — retire content by unpublishing it (`status`), or
    remove it from the files too.

Target shape: 3 tiers, ~10 topics, ~30 questions, every topic with ≥ 1
recipe (tier > 0) that the published questions alone can pay for, one gate
per tier > 0.

### 6.2 Lesson markdown
GitHub-flavored markdown (rendered through `react-markdown` + `rehype-sanitize`),
plus these blocks:
- ```` ```python run ```` (any language + `run`) → RunnableCodeBlock;
  ```` ```cpp title=bfs.cpp ```` → CodeBlock with filename
- `:::callout{kind=complexity|pitfall|note}` … `:::` → Callout
- `$$ … $$` on its own lines → Formula block
- `:::viz{id=binary-search}` → VisualizationFrame with a registered visualization
- `:::question{slug=two-sum}` → inline link card to a question

---

## 7. Routes

| route | notes |
|---|---|
| `/` | redirect → `/problems` (signed in) or `/signin` |
| `/signin`, `/signup`, `/forgot` (+ `/reset?token=`) | public; signed-in visitors redirect away |
| `/problems`, `/problems/[slug]` | catalog; editor + results |
| `/ide` | playground, custom stdin/stdout |
| `/submissions`, `/submissions/[id]` | history, detail |
| `/u/[handle]`, `/u/[handle]/badges` | profile, badges gallery + modal |
| `/learn`, `/learn/[track]`, `/learn/[track]/[lesson]`, `/learn/[track]/[module]/checkpoint`, `/learn/[track]/complete` | learn |
| `/map`, `/map/gates/[attemptId]` | learning loop: the tier map, a gate attempt |
| `/author/new`, `/author/[id]/edit` | ≥ author |
| `/library`, `/library/[area]`, `/library/[area]/[article]` | hidden; ≥ staff unless flag; noindex |
| `/dev/system` | non-production only |

Old routes `/p/[id]`, `/auth`, `/profile` redirect to their new homes.

Top bar: Learn, Map, IDE, Submissions. The catalog has no tab: the logo
opens it (`/` redirects signed-in visitors to `/problems`) and the jump box
(⌘/Ctrl+K) searches it. The profile menu holds Profile, Badges, Author
(≥ author), Library (when visible) and Sign out. *`/queue` and
`/me/library` — and the Problems and Queue tabs and the My Library menu
link — were removed on 2026-10-02 at the owner's request.*

---

## 8. Design language

- **Tokens** only (`--bg-0..4`, `--line-1..3`, `--fg-0..4`, `--accent*`,
  `--ok/warn/err/info` + `-bg`, `--r-sm..xl`, `--shadow*`). Dark `.cm` is the
  default; `.cm-light` swaps the palette. Theme persists in a `cm-theme`
  cookie so SSR renders the right class (no flash).
- **Type**: Inter (UI), JetBrains Mono (code, numbers, IDs — class `mono`).
  Dense, tool-like scale: 11–14 px body, 20–30 px headings, tight tracking.
- **Surfaces**: `--bg-0` page, `--bg-1` panels/navbar, `--bg-2` cards/inputs,
  1 px `--line-2` borders, radii 6–12, shadows only on overlays.
- **Status colors**: OK → `--ok`, WA/RE → `--err`, TLE/MLE → `--warn`,
  CE → `--info`, XX → `--fg-3`; always via `StatusPill` / `Pill`.
- **Components**: reuse `web/components/ui/*`; never hand-roll a button,
  pill, input or tab.
- **Icon names** (`IconName` in `components/ui/Icon.tsx`) — content JSON
  (topics, badges, areas) may only use these. Existing: `check x circle
  half-circle check-circle alert zap cpu memory clock search filter chev-down
  chev-right chev-left chev-up play pause skip-back skip-forward graduation
  sparkle target lightbulb info alert-circle gauge arrow-right arrow-down send
  copy refresh settings user list book flame github google lock lock-open eye
  eye-off plus minus close more external bookmark thumb msg trophy layers
  history terminal code drag star bolt trend hash`. Added by the UI kit:
  `map route book-open award coin sun moon log-out git-branch grid edit trash
  sort repeat shield puzzle network table window arrows-lr`.
- **A11y**: keyboard reachable, visible `focus-ring`, AA contrast in both
  themes, honor `prefers-reduced-motion` (transitions off, not shortened).
  `web/e2e/a11y.spec.ts` gates it: no serious or critical axe violation and
  exactly one `h1` per page in both themes, no sideways scroll at 375 px.
- **Responsive**: editor ≥ 1024 px; catalog, learn, library, profile ≥ 375 px.
- **Perf**: RSC by default; client components only for editor, visualizations,
  filters, interactive widgets. Monaco and visualizations are dynamically
  imported. LCP < 2 s on `/problems` and `/problems/[slug]`.
- **No route-level `loading.tsx` on routes that navigate by query string**
  (`/problems`, `/submissions`, …). In production builds Next 15.5's router
  never commits a same-path, query-only navigation under a route-level loading
  boundary — filters and pagination silently do nothing (dev mode doesn't
  prefetch, so it only shows up in `next start`). Use in-page `<Suspense>`
  for skeletons instead. `/problems/[slug]` has none either, for a different
  reason: React holds a Suspense reveal until ≥ 300 ms after its fallback
  painted, so a skeleton there delays the statement (the LCP element); the
  clicked catalog row shows a pending spinner instead. Only `/map` keeps a
  `loading.tsx`.

---

## 9. Environment

| var | where | notes |
|---|---|---|
| `DATABASE_URL` | web | Postgres (schemas app, content) |
| `AUTH_SECRET`, `AUTH_GITHUB_ID/SECRET` | web | GitHub OAuth optional |
| `COMPILE_SERVICE_URL`, `INTERNAL_TOKEN` | web + backend | shared secret |
| `FEATURE_LIBRARY_PUBLIC` | web | default `false` |
| `FEATURE_AI_REVIEW`, `ANTHROPIC_API_KEY` | web | default off |
| `RESEND_API_KEY`, `MAIL_FROM` | web | password-reset mail over Resend's HTTP API (`lib/mailer.ts`, plain fetch); either unset → the reset link is logged to the server console. Links use `AUTH_URL`'s origin when set (set it in production), else the request host |
| `SANDBOX_MODE`, `ISOLATE_CPU_PINNING`, `EXECUTION_RATE_LIMIT_MAX`, `COMPILE_CACHE_MAX_MB` | backend | `isolate` (production) or `local`; one CPU per run box (`round-robin`) or `off`; the circuit breaker per minute per process (6000); what the compile cache may hold on disk and in memory, in MB (1024, at least 64) |
| `DIRECTUS_*` | directus | see `deploy/` |
