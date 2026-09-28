-- Surrogate single-column ids for the content join tables (spec §2).
--
-- Directus only edits rows of tables with a single-column primary key, so
-- question_topics, gate_questions and component_deps (composite keys) were
-- read-only for staff. Each gets an `id` text primary key; the natural pair
-- stays unique (the index Prisma creates for @@unique), so compound-unique
-- lookups such as `questionId_topicId` keep working.
--
-- Ids are cuid-shaped like every other content id. New rows get theirs from
-- the writer — Prisma's @default(cuid()) in the web app and seed, the
-- content-integrity hook in Directus — so, as for every other content table,
-- the column has no database default. Existing rows are backfilled here with
-- a deterministic id derived from their natural pair ('c' + 24 hex chars of
-- md5(table:left:right)): unique because the pair is, and reproducible on any
-- copy of the database.
--
-- The end state is exactly what `prisma migrate diff` generates for the
-- schema (checked with `migrate diff --exit-code`); only the backfill steps
-- and the weight CHECK are hand-written.

-- ─── content.question_topics ────────────────────────────────────────────
ALTER TABLE "content"."question_topics" ADD COLUMN "id" TEXT;
UPDATE "content"."question_topics"
   SET "id" = 'c' || substr(md5('question_topics:' || "question_id" || ':' || "topic_id"), 1, 24);
ALTER TABLE "content"."question_topics"
  ALTER COLUMN "id" SET NOT NULL,
  DROP CONSTRAINT "question_topics_pkey",
  ADD CONSTRAINT "question_topics_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "question_topics_question_id_topic_id_key"
  ON "content"."question_topics"("question_id", "topic_id");
-- A weight is a share of the solve award (§3.2): zero or negative is never
-- meaningful. The seed and the authoring flow already require > 0; this also
-- covers Directus and SQL edits.
ALTER TABLE "content"."question_topics"
  ADD CONSTRAINT "question_topics_weight_positive" CHECK ("weight" > 0);

-- ─── content.gate_questions ─────────────────────────────────────────────
ALTER TABLE "content"."gate_questions" ADD COLUMN "id" TEXT;
UPDATE "content"."gate_questions"
   SET "id" = 'c' || substr(md5('gate_questions:' || "gate_id" || ':' || "question_id"), 1, 24);
ALTER TABLE "content"."gate_questions"
  ALTER COLUMN "id" SET NOT NULL,
  DROP CONSTRAINT "gate_questions_pkey",
  ADD CONSTRAINT "gate_questions_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "gate_questions_gate_id_question_id_key"
  ON "content"."gate_questions"("gate_id", "question_id");

-- ─── content.component_deps ─────────────────────────────────────────────
-- The no-self-dependency CHECK (integrity_guards) is unchanged; cycles are
-- rejected by the seed validator, the app and the Directus hook.
ALTER TABLE "content"."component_deps" ADD COLUMN "id" TEXT;
UPDATE "content"."component_deps"
   SET "id" = 'c' || substr(md5('component_deps:' || "component_id" || ':' || "depends_on_id"), 1, 24);
ALTER TABLE "content"."component_deps"
  ALTER COLUMN "id" SET NOT NULL,
  DROP CONSTRAINT "component_deps_pkey",
  ADD CONSTRAINT "component_deps_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "component_deps_component_id_depends_on_id_key"
  ON "content"."component_deps"("component_id", "depends_on_id");
