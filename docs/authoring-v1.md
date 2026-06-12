# Authoring platform — v1 plan

## Goal

Turn Codemare from a fixed problem set into a platform where any signed-in
user **authors content** — "books" of lessons and problems — and publishes
them for others to learn from and solve.

**v1 is entirely free.** No payments, no paywall. But the data model is
shaped so the paywall slots in later with no destructive migration:
monetization (per-book purchase, platform-collects-first) is **designed for,
not built**.

## What a user can do in v1

**As an author**
- Create a Book (title, description, draft/published).
- Add Lessons (markdown prose) and Problems (statement, test cases, starter
  code) to it.
- Order the items; publish when ready.

**As a reader (any signed-in user)**
- Browse published books.
- Read lessons; solve a book's problems through the existing judge.

Author = owner (can edit). Everyone else is read-only. Everything published
is free to read and solve.

## The linchpin: move the catalog into Postgres

Today the compile service owns the catalog (`backend/src/data/problems/*.json`)
and looks a problem up by id at execution time. Authored problems live in
Postgres, which the compile service can't see — so this must change, and it's
the foundation everything else builds on.

**New contract — the compile service stops owning the catalog and becomes a
pure executor.** Instead of looking a problem up, the caller supplies
everything:

```
# before
POST /v1/execute { problemId, language, code }     # service reads the problem

# after
POST /v1/execute { language, code, functionName, testCases }   # caller supplies it
```

- The web app reads the problem (function name + test cases) from Postgres and
  passes them in the request.
- The compile service keeps `codeWrapperService` (language-specific harness
  generation) — it just wraps using the supplied `functionName` + `testCases`
  rather than ones it loaded itself.
- `backend/src/data/problems/*.json`, `getFullProblem`, and the
  `/v1/problems` endpoints are removed from the compile service. The seed
  (`web/prisma/seed.ts`) already loads those JSON files into the `Problem`
  table, so the existing two problems survive the move.

IDE mode is unaffected (it already supplies raw code + stdin).

## Data model (Prisma additions)

```prisma
model Book {
  id          String   @id @default(cuid())
  slug        String   @unique
  title       String
  description String   @db.Text
  authorId    String
  visibility  Visibility @default(DRAFT)   // DRAFT | PUBLISHED
  // --- deferred monetization (nullable now, filled when paywall lands) ---
  priceCents  Int?
  currency    String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  author User       @relation(fields: [authorId], references: [id])
  items  BookItem[]
}

enum Visibility { DRAFT PUBLISHED }

// Ordered, polymorphic list of a book's contents.
model BookItem {
  id        String   @id @default(cuid())
  bookId    String
  order     Int
  kind      ItemKind            // LESSON | PROBLEM
  lessonId  String?  @unique
  problemId String?  @unique
  preview   Boolean  @default(false)   // future paywall: free sample item

  book    Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  lesson  Lesson?  @relation(fields: [lessonId], references: [id], onDelete: Cascade)
  problem Problem? @relation(fields: [problemId], references: [id], onDelete: Cascade)

  @@index([bookId, order])
}

enum ItemKind { LESSON PROBLEM }

model Lesson {
  id              String   @id @default(cuid())
  title           String
  contentMarkdown String   @db.Text
  createdAt       DateTime @default(now())
  item            BookItem?
}

// Problem already exists; add author + book linkage. authorId/bookId nullable
// so the seeded global-catalog problems (no author, no book) keep working.
model Problem {
  // ...existing fields...
  authorId String?
  bookId   String?
  author   User? @relation(fields: [authorId], references: [id])
  book     Book? @relation(fields: [bookId], references: [id])
  item     BookItem?
}

// Deferred — NOT built in v1, shown so the shape is agreed:
// model Entitlement { userId; bookId; source; createdAt; @@unique([userId,bookId]) }
```

Access is funneled through one server-side function so the paywall has exactly
one place to land:

```ts
// v1: published books are readable by any signed-in user; authors see drafts.
// later: || hasEntitlement(user, book) for paid books.
function canAccessBook(user, book) {
  return book.visibility === 'PUBLISHED' || book.authorId === user?.id;
}
```

## Phasing

**Phase A — Foundation (catalog → Postgres, compile contract change)**
- Prisma: add Book/BookItem/Lesson, extend Problem; migrate.
- Compile service: `/v1/execute` takes `{ language, code, functionName, testCases }`; drop the JSON catalog + `/v1/problems`.
- Web: `lib/compile.ts` and the execute server action read the problem from
  Postgres and pass its function name + test cases. Catalog page reads from
  Postgres, not the compile service.
- Net: existing two problems work end-to-end through the DB. No new UI yet.

**Phase B — Authoring**
- `/author` (my books), `/author/[bookId]` (edit: metadata, ordered items).
- Problem editor: title, difficulty, markdown statement, function name,
  starter code per language, test cases (args + expected output, hidden flag).
  Optional: paste a reference solution and run it to fill expected outputs.
- Lesson editor: title + markdown.
- Publish toggle. All author actions are server actions guarded by
  `book.authorId === session.user.id`.

**Phase C — Reading**
- `/books` (browse published), `/books/[slug]` (TOC).
- Lesson view: sanitized markdown render.
- Problem view: the existing editor/judge workspace, sourced from the book.

**Phase D — Monetization (deferred, separate milestone)**
- `Entitlement` table, `Book.priceCents`, Stripe Checkout + webhook,
  `canAccessBook` gains the entitlement check, free-preview items stay open.
  Platform collects first; creator payouts handled off-platform initially,
  Stripe Connect later.

## Risks / decisions to lock before coding

1. **XSS** — lessons + problem statements are user-authored markdown. Must
   render through a sanitizing pipeline (e.g. `react-markdown` +
   `rehype-sanitize`). Non-negotiable; this is the main new attack surface.
2. **Auth must actually work** — v1 needs real signed-in authors. Auth is
   scaffolded but not configured. Need at least GitHub OAuth (or a credentials
   provider) wired and a working DATABASE_URL before Phase B is usable.
3. **Compile contract change is load-bearing** — it touches the one working
   execution path. Do Phase A carefully; keep `?wait=true` + queue behavior
   intact; the only change is where problem data comes from.
4. **Expected-output generation** runs untrusted reference solutions — fine,
   the judge sandboxes them, but it means authoring depends on the judge being
   up.
5. **Standalone vs book problems** — `Problem.bookId` nullable keeps the
   global catalog (seeded, authorless) and book-owned problems in one table.

## Out of scope for v1

Payments, creator payouts, subscriptions, ratings/reviews, search across
books, versioning/drafts of individual items, rich (non-markdown) editor,
collaborative authoring.
