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
  always reachable during their attempt).
- The map is where learners find questions: every published question is
  listed under each of its topics (a composite under all of them), in
  curriculum order — the primary (heaviest-weight) topic's tier, then that
  topic's place in its tier, then difficulty, then title — with the
  learner's progress (`solved` once a submit or gate submission is
  accepted, `attempted` after any run, submit or gate without that). An
  unlocked topic lists its questions, each linking to the editor, under
  "n/m solved"; a question that a still-locked topic keeps closed (a
  composite's other topic) names that topic instead of linking. A locked
  or unlockable topic shows only how many questions it holds. Published
  questions without a topic, a content gap, are listed on their own.
  *(Until 2026-10-02 a problem catalog at `/problems` listed them with
  search and filters, and locked ones with a lock linking to `/map`; it was
  removed at the owner's request — see §7.)*

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
than this one; it is stored with the submission (the `fast_solve` badge reads
it). The result card and a submission's detail page show "Faster than N% of
other learners" only when at least 30 learners' latest accepted solutions (same question and language, the
learner's own included) stand behind it — `MIN_PERCENTILE_SAMPLE` and
`percentileToShow` in `lib/server/rules/scoring.ts` — because among two or
three solvers the number says nothing about the code. A presentation
threshold only: the stored value and the badges are unchanged
(`getSubmissionView` applies it to the detail page; the profile shows no
percentile).

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

Also an API route, not a judge route: `GET /api/topic-art/[slug]?v=<fingerprint>`
returns one topic scene's SVG markup (§8, topic art) for the map's lazily
loaded thumbnails — a fixed list of slugs (anything else 404), session
required like every `/api` route, immutable-cached for a year (the fingerprint
makes a changed drawing a new URL) and compressed by the handler itself
(brotli or gzip), because Next does not compress a route handler's response.

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
| `/` | redirect → `/map` (signed in) or `/signin` |
| `/signin`, `/signup`, `/forgot` (+ `/reset?token=`) | public; signed-in visitors redirect away (to a safe `next`, else `/map`) |
| `/problems/[slug]` | editor + results |
| `/ide` | playground, custom stdin/stdout |
| `/submissions`, `/submissions/[id]` | history, detail |
| `/u/[handle]`, `/u/[handle]/badges` | profile, badges gallery + modal |
| `/learn`, `/learn/[track]`, `/learn/[track]/[lesson]`, `/learn/[track]/[module]/checkpoint`, `/learn/[track]/complete` | learn |
| `/map`, `/map/gates/[attemptId]` | home and the learning loop: the tier map with every topic's problems (§3.4), a gate attempt |
| `/author/new`, `/author/[id]/edit` | ≥ author |
| `/library`, `/library/[area]`, `/library/[area]/[article]` | hidden; ≥ staff unless flag; noindex |
| `/dev/system`, `/dev/topic-art` | non-production only (every UI-kit component; every topic scene) |

Old routes `/p/[id]`, `/auth`, `/profile` redirect to their new homes, and
`/problems` — with whatever query string an old link carries — redirects to
`/map` (`?topic=<slug>` to that topic's card, `/map#topic-<slug>`).

Top bar: Learn, Map, IDE, Submissions. The map is home: the logo opens it
(`/` redirects signed-in visitors to `/map`, the Map tab then current) and
it opens on the learner's next topic and lists every topic's problems. The
profile menu holds Profile, Badges,
Author (≥ author), Library (when visible) and Sign out. *`/queue` and
`/me/library` — and the Problems and Queue tabs and the My Library menu
link — were removed on 2026-10-02 at the owner's request. So was the
problem catalog the same day: `/problems` with search, difficulty, status,
topic, tag and company filters, curriculum order and pagination (the
brief's screen 01, with its empty state 08b), and the ⌘/Ctrl+K "Jump to
problem" box that searched it (decision 39 in `docs/DECISIONS.html`).*

**Heroes are animated topic art, not big text** (decisions 40 and 41). The
sign-in, sign-up, forgot and reset screens show a reel of the ten topic
scenes beside the form — a banner above it below 900 px, not hidden — with a
topic switcher and a pause button. The map has no headline: the shared page
header (a 26 px `h1`, "Tier map") and one quiet line of progress ("9/30
problems solved · 3/10 topics unlocked · 1/3 tiers open", ending in a "How
it works" link), then a hero of the learner's next topic (its animated art,
name, caption, "n/m solved" and one button), chosen by the pure rule in
`lib/server/featuredTopic.ts` over the map's own view: the first unlocked topic with an unsolved problem that opens for the
learner ("Continue: …" for an attempted one, else "Start: …"), else the
first topic ready to unlock ("Unlock …"), else the first tier whose gate
is takeable — its tier closed, the tier before it open, no attempt running,
no cooldown — ("Take the Foundations Gate", to `#gate-<id>`, kicker "Ready
for the gate", art of the first topic that tier opens), else the topic
closest to unlocking ("See what's missing"), else "Every topic cleared"
(decision 43). While a gate attempt is running its banner holds the page's one
primary action and the hero's button is the quiet variant (decision 44).

**The map is calm** (decision 42). Under the hero at most one more line may
appear (`lib/server/mapMilestone.ts`; it adds no restriction): a topic that is
ready to unlock, else a takeable gate whose pass threshold is met ("You can
take the Foundations Gate now — 3 of its 4 problems solved", to the gate).
"How it works" gives the loop in three steps in the page's own words (solve
problems, earn tokens, spend them): open while nothing is solved and it has
not been dismissed (the `cm-first-run` cookie, so the server knows), put away
by "Got it" or by the first solve, and brought back by the link in the
header's line of progress, in the page. Below that, an open tier is its
header and one row per topic (thumbnail, name, "n/m solved · k tokens", the
problems one click away; the server opens the hero's topic once a problem is
solved and the topic last worked in, and a row or closed-tier panel the
learner opens stays open for the session — `MapMemory`, `sessionStorage`
keys `cm-map-open` and `cm-map-scroll`, with the scroll position restored
after Back or Forward); a closed tier is ONE collapsed panel (its name,
"Opens after the …", its topics as posters and names) that opens to the gate
line and compact topics, and says what blocks it once, not on every topic. A
link to anything inside a closed panel or row opens it. The Map's whole status
vocabulary is three labels — Open, Ready to unlock, Locked — and difficulty is
quiet text with a dot, not a filled pill. Card thumbnails are still posters
(dimmed when locked); only the hero animates.

**The result card** (decision 42). After a run or submit the Result tab leads
with the verdict as a headline and one line ("Accepted — all 8 tests
passed"; "Wrong answer — 4 of 8 tests passed"), then the reward rows ("+1
token · Arrays & Hashing", a badge earned), then "Next problem" (primary; in a
gate attempt "Back to the gate") and "Back to the map", then runtime, memory
and the percentile (§3.8) as one quiet row. A failing verdict leads with what
happened, what to try, and the first failing visible test (input, expected,
your output); the per-test list sits below, collapsed. Rewards and badges are
not also toasts. "Next problem" is `lib/server/nextProblem.ts`: forward only —
the first unsolved problem that opens for the learner after the current one
in its topic, then in the following topics in curriculum order; none → only
"Back to the map". Below 1024 px the problem page shows one pane at a time
(Problem · Code · Result) with a 44 px Run/Submit bar; a new result switches
to the Result pane and takes focus, a failing one offers "Back to code"
(focusing the Code pane, not Monaco), and the statement's first example
stays open with the rest behind "More". A tablet upright (768–1023 px wide
and at least 600 px tall) gets two panes — the statement, and the editor
with the console under it — and a phone on its side keeps one pane
(`useLayout` in `Workspace/useModKey.ts`). In a gate attempt the phone's
banner is one 46 px line (the clock and "0/4 · pass with 3", with a toggle
for the problems). Run and Submit wait until Monaco has mounted; the map
prefetches Monaco's files when idle (`EditorPrefetch`, the names pinned in
`monacoFiles.ts`, checked by `e2e/editor.spec.ts`).

**The other pages follow the map** (decision 43). Every page has the shared
`PageHeader` (a 26 px `h1`, one line of context, actions at the right, no
eyebrow), the map's page width and `StatusDot`/`DifficultyText` for
progress and difficulty, and verdicts in the result card's words. *Learn*:
one recommendation ("Start Foundations" / "Continue: …", `pickRecommendation`),
tracks as rows, the bar and counts only once a track is started, lessons and
checkpoints as rows with the map's glyphs; lesson prose is 16 px; a snippet's
Run is neutral. *IDE*: the problem page's toolbar; below 1024 px Code · Test
cases · Output, one at a time, the output taking focus when a run finishes.
*Submissions*: quiet filters, "Accepted" / "Wrong answer" with the short code
small, two-line rows on a phone; the detail reads like the result card
(headline, then one row of runtime, memory, compile time and time per test)
and has no "Beats" bar. *Profile*: identity, one stats card once something is
solved (Solved by difficulty, Streak, Tokens; acceptance and fastest run under
"More stats"), the activity map from 7 active days, tokens and Learn blocks
only when they have content, recent submissions, badges (`profileSections`).
*Badges*: underline tabs with counts and horizontal cards (emblem, name,
rarity as a word, the date or progress), the focus view in a dialog.

---

## 8. Design language

- **Tokens** only (`--bg-0..4`, `--line-1..3`, `--fg-0..4`, `--fg-ph` (placeholders, at least 4.5 : 1), `--accent*`,
  `--ok/warn/err/info` + `-bg`, `--r-sm..xl`, `--shadow*`). Dark `.cm` is the
  default; `.cm-light` swaps the palette. Theme persists in a `cm-theme`
  cookie so SSR renders the right class (no flash).
- **Type**: Inter (UI), JetBrains Mono (code, numbers, IDs — class `mono`).
  One scale, the `--fs-*` tokens in `globals.css`: nothing below 12 px
  (`--fs-xs`), body 14 px (`--fs-body`; 16 px on phones), `--fs-lg` 16,
  `--fs-xl` 20, `--fs-2xl` 26; sentence-case labels and no tiny uppercase
  micro-labels; `Pill` sizes are 12/13/14 px.
- **One height ladder** (decision 43): controls are `--ctl-xs/sm/md/lg` =
  22/28/32/38 px and `--tap` = 44 px; on phones and coarse pointers
  (`max-width: 720px` or `pointer: coarse`) fields are 16 px and 44 px tall
  and medium and large buttons (a long label wraps instead of widening the
  page), tabs, menu rows, breadcrumbs and dialog buttons are 44 px; a small
  button that is a page's action passes `tap`
  (a page's own size wins: the kit's touch rules carry no more specificity
  than its base rules, except field text, which is enforced at 16 px). `Pill`
  heights are fixed (22/24/28). The language mark is a 12 px tag and avatar
  initials are at least 12 px. The shell is `100dvh` (`.app-shell`) and the
  viewport's `interactive-widget=resizes-content` lets the soft keyboard
  shrink it.
- **One page header, one dialect** (decisions 43 and 44): `PageHeader` (26 px
  title, one line, actions at the right, no eyebrow), `DifficultyText` for
  difficulty everywhere (the problem header and the locked page too),
  `StatusDot` for progress and `VerdictText` for verdicts — the glyph and
  name in the verdict's tone, sentence case, the short code small;
  `VERDICT_LOOK` in `lib/client/resultCopy.ts` is the one table of tones and
  glyphs. No learner-facing screen has a filled or outlined capsule: a cost, a
  role, a test's kind, a recipe's state is a word (`e2e/capsules.ts` fails a
  page that has one; the authoring pages and the sign-in screens' feature
  chips are the exceptions). `/dev/system` shows them.
- **Calm pages** (decision 42): say each thing once; collapse what the
  learner cannot use yet; one primary action per screen (the hero's button,
  the result's "Next problem"); the same words, and no constraint added to
  make a page simpler. The measures used for the map, fresh learner: first
  laptop screen under ~100 words and ~14 controls, the page under ~2
  screens, at most 8 font sizes.
- **Surfaces**: `--bg-0` page, `--bg-1` panels/navbar, `--bg-2` cards/inputs,
  1 px `--line-2` borders, radii 6–12, shadows only on overlays.
- **Status colors**: OK → `--ok`, WA/RE → `--err`, TLE/MLE → `--warn`,
  CE → `--info`, XX → `--fg-3`; always via `StatusPill` / `Pill`.
- **Components**: reuse `web/components/ui/*`; never hand-roll a button,
  pill, input or tab.
- **Topic art** (`components/TopicArt`, decision 40): one animated SVG scene
  per topic slug, as inline SVG with CSS keyframes — no libraries, image
  files or JS animation loops. Rules: each scene runs the real algorithm of
  its topic (a header comment says what it shows) and ends in a payoff (a
  burst and a +1 coin); its *base, unanimated markup is its poster* (the
  frame at the payoff), which is what `prefers-reduced-motion`, a locked
  topic's card and the reel's reduced state show — keyframes only override
  it; no text inside the SVG, the art is decoration (`aria-hidden`) with the
  topic's name and caption beside it; colors only from the `--art-*` tokens
  (both themes); a 7 s loop everywhere (`LOOP_MS` = the stylesheet's `@L`,
  tested); keyframes are generated by `kfx.ts` from specs; nothing rotates
  or loops without a pause control (WCAG 2.2.2) — the sign-in reel has one,
  holds for hover, focus, a hidden tab and off-screen, and the map's
  thumbnails pause off-screen. To add a topic: a scene, its registry
  entries, an `--art-<slug>` token in both themes and its keyframe specs;
  `lib/topicArt.test.ts` fails until it is all there (unknown slugs draw a
  fallback scene). `/dev/topic-art` shows every scene.
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
  exactly one `h1` per page in both themes, no sideways scroll at 375 px; its
  route table `FLOOR_ROUTES` (18 routes, an owner each — add a route there)
  also asserts, per route, no visible text under 12 px (both themes at 1440,
  dark at 375; SVG text and screen-reader-only text are ignored), 16 px form
  fields at 375 px and a phone gate, and the top bar's 44 px targets;
  `auth.spec.ts` holds placeholder text at 4.5 : 1 in both themes.
- **Responsive**: the problem page is three panes from 1024 px, two on a
  tablet upright (768–1023 px wide, at least 600 px tall) and one pane at a
  time below that (Problem · Code · Result, a 44 px action bar); the IDE
  likewise (Code · Test cases · Output); map, learn, library, profile and
  submissions ≥ 375 px; primary touch targets ≥ 44 px on phones; form fields
  16 px on phones (iOS Safari zooms smaller ones).
- **Perf**: RSC by default; client components only for editor, visualizations,
  filters, interactive widgets. Monaco and visualizations are dynamically
  imported. LCP < 2 s on `/map` (home) and `/problems/[slug]`. The topic
  art's scenes are about 78 KB raw: the sign-in pages carry them (about +25 KB
  gzipped), the map loads its thumbnails' scenes on demand from
  `/api/topic-art` (+15 KB, +0.02 s first-visit LCP — inline they cost +43 KB
  and +0.12 s).
- **No route-level `loading.tsx` on routes that navigate by query string**
  (`/submissions`). In production builds Next 15.5's router never commits a
  same-path, query-only navigation under a route-level loading boundary —
  filters and pagination silently do nothing (dev mode doesn't prefetch, so
  it only shows up in `next start`). Use in-page `<Suspense>` for skeletons
  instead. `/problems/[slug]` has none either, for a different reason:
  React holds a Suspense reveal until ≥ 300 ms after its fallback painted,
  so a skeleton there delays the statement (the LCP element); the clicked
  problem on the map shows a pending spinner instead. `/map` lost its own
  skeleton on 2026-10-02 for the same reason once it became the home page
  (on a return visit it held the LCP back by ~0.34 s, and above a gate
  attempt it turned `notFound()` into a 200): no route has a `loading.tsx`
  now.

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
