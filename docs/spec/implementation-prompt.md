# Codemare — full implementation prompt

> Verbatim copy of the design project's `Implementation Prompt.md`. The design
> source files it references (`/design/tokens.css`, `/design/MVP Architecture.html`,
> `/design/index.html`, `/design/screens/*.jsx`, `/design/lib/*.jsx`,
> `/design/export/_lib-hidden.html`) are **not in this repo yet**. Until they
> are synced in via `/design-sync`, `docs/spec/architecture.md` is the working
> reconstruction of `MVP Architecture.html`, and the existing tokens in
> `web/app/globals.css` + `web/components/ui/*` are the design system.

---

## Role & goal
Build **Codemare**, a production DSA practice and learning platform, from the design files in `/design`. The end product is a working web app: learners solve problems in an in-browser editor, code is judged in a sandbox with µs-precision timing, and they progress through a tiered learning loop that uses tokens and unlock recipes. The UI is dark-first with a light mode.

## Source of truth (read these before writing code)
- `/design/tokens.css`: every color, font, radius and shadow. Port it as-is into CSS variables. Don't invent new colors. The light theme is the `.cm-light` class.
- `/design/MVP Architecture.html`: data model, schemas, token ledger rules, unlock recipes, gates and infrastructure. Follow it exactly.
- `/design/index.html` plus `/design/screens/*.jsx` and `/design/lib/*.jsx`: every screen as a static artboard. Match layout, spacing, type and states pixel-close. Rebuild the components properly; the design JSX is reference only and must not be copied into the app.
- `/design/export/_lib-hidden.html` (`screens/cpa.jsx`, `lib/cpa-*.jsx`): the algorithms Library. Build it, but keep it **hidden** (see §7).

## Stack (already decided — don't change it)
- Next.js (App Router) + TypeScript, API routes or a separate Node API
- Postgres with two schemas: `content.*` (edited by the admin) and `app.*` (written by the API only)
- Self-hosted **Judge0** for code execution: Python, JS/TS, Java, C++ and Go. No network access, CPU and memory limits.
- **Directus** mapped onto `content.*` as the admin CMS, plus one custom module for the recipe editor
- Everything runs on one Hetzner VPS with Docker Compose. Nightly `pg_dump` to a Hetzner Storage Box.
- Fonts: Inter and JetBrains Mono, self-hosted with `next/font`
- Editor: Monaco or CodeMirror 6, themed from the tokens

## 1. Design system (build first)
Create `/components/ui` from `screens/system.jsx` and `lib/ui.jsx`:
- Button (default, primary, ghost, danger; sizes sm, md, lg; with icon), Pill (tones muted, ok, warn, err, info, accent; sizes xs, sm), Chip, Input, Select, Tabs, Toggle, Tooltip, Modal, Toast, Skeleton, ProgressBar, Kbd, Breadcrumb
- CodeBlock and RunnableCodeBlock (`lib/codeblock.jsx`), with syntax tokens, filename, language, and run results (ms and KB)
- Callout (complexity, pitfall, note), Formula block, VisualizationFrame (step-through with play, pause and scrub)
- Icon set (`lib/icons.jsx`), as inline SVG components
- A `/dev/system` route that renders every component in both themes, matching artboards "00 · System · dark/light"

## 2. Screens → routes
| Artboard | Route |
|---|---|
| 01 Catalog (+ 08b empty) | `/problems` — search, filters (difficulty, tags, company, status), sticky header, pagination |
| 02 Editor — Accepted / TLE | `/problems/[slug]` — statement, examples, editor, run/submit, per-test results |
| 03 Results hero | results panel inside the editor: runtime (µs), memory, percentile vs. other submissions, per-test breakdown |
| 04 IDE | `/ide` — free playground with custom stdin/stdout |
| 05 Submissions | `/submissions`, `/submissions/[id]` |
| 06 Profile | `/u/[handle]` — stats, heatmap, badges strip |
| 07a/b/c Auth | `/signin`, `/signup`, `/forgot` |
| 08 States | shared empty, loading, 404 and 500 components used everywhere |
| L1 Lesson | `/learn/[track]/[lesson]` — prose, runnable code, visualizations |
| L2 Track | `/learn/[track]` |
| L3 Learn home | `/learn` |
| L6 Checkpoint quiz | `/learn/[track]/[module]/checkpoint` |
| L7 Track completion | `/learn/[track]/complete` |
| L8 Nav additions | top nav tabs, profile card and related-lessons strip, added to existing screens |
| B1 Badges gallery, B2/B3 focus | `/u/[handle]/badges`, badge modal |
| A1 Create question | `/author/new`, `/author/[id]/edit` — statement, examples, tests, tags, sticky publish rail |
| T1 Tier map | `/map` — tiers, topics, recipes, "what's blocking you" |
| T2a Predict / T2b Build | `/queue` — predict step, then build step with the hint ladder |
| T3 My Library | `/me/library` — the learner's built components |
| T4 Admin topic editor | Directus custom module |

## 3. Data model
Implement the schemas in `MVP Architecture.html` exactly, as migrations (Drizzle or Prisma):
- `content`: tiers, topics, unlock_recipes, recipe_items, components, component_deps, build_steps, questions, question_topics, hints, gates, gate_questions, badges
- `app`: users, sessions, token_ledger (append-only), unlocks, submissions, test_results, component_versions, hint_uses, gate_attempts, badge_awards, lesson_progress
- Token balance is `SUM(token_ledger)`. A spend is a negative row, and it is checked in a transaction so the balance can never go negative.
- Ledger rows store the source difficulty, so recipes can require "2 Recursion tokens from Medium or harder".

## 4. Judge / runner
- `POST /api/run` (custom input) and `POST /api/submit` (hidden tests) are queued to Judge0.
- The runner assembles the learner's latest **passing** version of each dependency, then the submission, then the tests.
- It returns per-test pass/fail, runtime in µs, memory in KB, and the test's `explain_on_fail` text.
- Stream status with SSE: queued → compiling → running → per-test → verdict.
- Verdicts: Accepted, Wrong Answer, TLE, MLE, RE and CE, with the exact colors and pills from the editor artboards.
- Rate limit per user. Cap source size.

## 5. Learning loop logic
- Tier 0 is free. Other tiers open through gates: pass threshold plus a 12–24 h cooldown.
- A topic unlocks when any one of its recipes is satisfied. "What's blocking you" shows the missing tokens for the cheapest recipe.
- Hint ladder: nudge → concept → pseudo → line → solution. Show the token or score cost **before** the hint is revealed, and log it in `hint_uses`.
- Composite questions pay higher-tier tokens, weighted through `question_topics`.
- AI review worker (optional flag): runs **after** the tests pass, never in their place. Uses a cheap model by default and escalates on request. Put the stable instructions first in the prompt so they can be cached.

## 6. Auth & accounts
Email + password and GitHub OAuth (Auth.js or Lucia). Roles: `learner`, `author`, `staff` and `admin`. `/author/*` needs author or higher. Admin means Directus plus staff routes.

## 7. Library (hidden)
- Build `/library`, `/library/[area]` and `/library/[area]/[article]` from `screens/cpa.jsx`: the master index with progress, area pages with chapters and metadata, and article pages (idea, formula, runnable C++, visualization, applications, pitfall, practice).
- Content goes in `content.library_*` tables, editable in Directus. Write original content. **Don't** copy text from cp-algorithms.com.
- **Hidden:** there are no links to it anywhere (nav, footer, search, sitemap). Add `noindex` and a `robots.txt` Disallow. The nav link sits behind `FEATURE_LIBRARY_PUBLIC=false`. Optionally gate it to staff (non-staff get a 404).
- Lazy-load the route bundle and data so none of it ends up in the main bundle.

## 8. Performance & quality bars
- LCP < 2.0 s on `/problems` and `/problems/[slug]` (4G, mid-range device). Code-split Monaco and the visualizations.
- Render with RSC by default; use client components only where needed (editor, visualizations, filters).
- Accessible: keyboard navigation for everything, visible focus rings, AA contrast in both themes, `prefers-reduced-motion` respected.
- Responsive down to 1024 px for the editor and 375 px for catalog, learn, library and profile.
- Tests: unit tests for ledger, unlock and recipe logic; Playwright for sign-up → solve → submit → unlock.

## 9. Delivery order
1. Tokens + UI kit + `/dev/system`
2. Auth + DB migrations + seed data (3 tiers, ~10 topics, ~30 problems)
3. Catalog → Editor → Judge0 → Results → Submissions
4. Tier map → Queue (Predict/Build + hints) → My Library → gates
5. Learn (home, track, lesson, quiz, completion)
6. Profile + badges
7. Authoring + Directus admin
8. Hidden Library
9. Performance pass, a11y pass, Docker Compose deploy to Hetzner, backups

After each step, run the app, compare each screen with its artboard in `/design/index.html`, and list any differences before moving on. Ask me before changing any decision in `MVP Architecture.html`.
