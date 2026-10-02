-- Remove the Queue and My Library (decision 38, 2026-10-02).
--
-- The owner tested the running site and judged the Queue — components with
-- predict and build steps, built into My Library — not a usable feature.
-- This drops everything only it used: content.components, component_deps
-- and build_steps; app.component_versions and step_progress; the
-- build_step_id columns of hints, hint_uses and submissions; the
-- BuildStepKind and StepStatus enums and the `build` submission kind.
--
-- Kept on purpose: LedgerReason `build` and LedgerRefType `build_step`.
-- app.token_ledger is append-only (a trigger raises on UPDATE / DELETE), so
-- the tokens learners earned from build steps stay in their balances.
--
-- No explicit BEGIN / COMMIT: the script runs as one implicit transaction,
-- so it applies completely or not at all. The rows go first (step 1) so the
-- NOT NULL changes and the enum swap (step 3) cannot trip over them. The DDL
-- in step 3 is what `prisma migrate diff` generates for the schema.

-- ─── 1. The Queue's rows ────────────────────────────────────────────────
-- Hint reveals of build steps (they would also go with their hints below).
DELETE FROM "app"."hint_uses" WHERE "build_step_id" IS NOT NULL OR "question_id" IS NULL;

-- Hints of build steps: a hint is a question's from now on.
DELETE FROM "content"."hints" WHERE "build_step_id" IS NOT NULL OR "question_id" IS NULL;

-- Build submissions; their test_results and ai_reviews cascade (as would
-- their component_versions).
DELETE FROM "app"."submissions" WHERE "kind" = 'build';

-- Learner progress through the Queue.
DELETE FROM "app"."component_versions";
DELETE FROM "app"."step_progress";

-- Badges that count built components, with their awards. Badge criteria are
-- parsed when the gallery reads them, so a leftover `components_built` row
-- would be shown without a way to earn it.
DELETE FROM "app"."badge_awards"
 WHERE "badge_id" IN (SELECT "id" FROM "content"."badges" WHERE "criteria"->>'kind' = 'components_built');
DELETE FROM "content"."badges" WHERE "criteria"->>'kind' = 'components_built';

-- (The components, their dependencies and build steps go with their tables.)

-- ─── 2. Integrity guards that name build steps (20260928094820) ─────────
-- "Exactly one of question / build step" becomes question_id NOT NULL
-- (step 3). component_deps_no_self_dependency goes with its table.
ALTER TABLE "content"."hints" DROP CONSTRAINT "hints_exactly_one_target";
ALTER TABLE "app"."hint_uses" DROP CONSTRAINT "hint_uses_exactly_one_target";

-- ─── 3. Schema ──────────────────────────────────────────────────────────
-- SubmissionKind without `build` (Postgres cannot drop an enum value).
CREATE TYPE "app"."SubmissionKind_new" AS ENUM ('run', 'submit', 'gate');
ALTER TABLE "app"."submissions" ALTER COLUMN "kind" TYPE "app"."SubmissionKind_new" USING ("kind"::text::"app"."SubmissionKind_new");
ALTER TYPE "app"."SubmissionKind" RENAME TO "SubmissionKind_old";
ALTER TYPE "app"."SubmissionKind_new" RENAME TO "SubmissionKind";
DROP TYPE "app"."SubmissionKind_old";

-- DropForeignKey
ALTER TABLE "app"."component_versions" DROP CONSTRAINT "component_versions_component_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."component_versions" DROP CONSTRAINT "component_versions_submission_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."component_versions" DROP CONSTRAINT "component_versions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."hint_uses" DROP CONSTRAINT "hint_uses_build_step_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."step_progress" DROP CONSTRAINT "step_progress_build_step_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."step_progress" DROP CONSTRAINT "step_progress_user_id_fkey";

-- DropForeignKey
ALTER TABLE "app"."submissions" DROP CONSTRAINT "submissions_build_step_id_fkey";

-- DropForeignKey
ALTER TABLE "content"."build_steps" DROP CONSTRAINT "build_steps_component_id_fkey";

-- DropForeignKey
ALTER TABLE "content"."component_deps" DROP CONSTRAINT "component_deps_component_id_fkey";

-- DropForeignKey
ALTER TABLE "content"."component_deps" DROP CONSTRAINT "component_deps_depends_on_id_fkey";

-- DropForeignKey
ALTER TABLE "content"."components" DROP CONSTRAINT "components_topic_id_fkey";

-- DropForeignKey
ALTER TABLE "content"."hints" DROP CONSTRAINT "hints_build_step_id_fkey";

-- DropIndex
DROP INDEX "app"."hint_uses_user_id_build_step_id_idx";

-- DropIndex
DROP INDEX "content"."hints_build_step_id_level_key";

-- AlterTable
ALTER TABLE "app"."hint_uses" DROP COLUMN "build_step_id",
ALTER COLUMN "question_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "app"."submissions" DROP COLUMN "build_step_id";

-- AlterTable
ALTER TABLE "content"."hints" DROP COLUMN "build_step_id",
ALTER COLUMN "question_id" SET NOT NULL;

-- DropTable
DROP TABLE "app"."component_versions";

-- DropTable
DROP TABLE "app"."step_progress";

-- DropTable
DROP TABLE "content"."build_steps";

-- DropTable
DROP TABLE "content"."component_deps";

-- DropTable
DROP TABLE "content"."components";

-- DropEnum
DROP TYPE "app"."StepStatus";

-- DropEnum
DROP TYPE "content"."BuildStepKind";
