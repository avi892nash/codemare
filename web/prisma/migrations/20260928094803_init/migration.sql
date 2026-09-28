-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "content";

-- CreateEnum
CREATE TYPE "content"."Difficulty" AS ENUM ('Easy', 'Medium', 'Hard');

-- CreateEnum
CREATE TYPE "content"."Language" AS ENUM ('python', 'javascript', 'typescript', 'cpp', 'java', 'go');

-- CreateEnum
CREATE TYPE "content"."CompareMode" AS ENUM ('ordered', 'unordered');

-- CreateEnum
CREATE TYPE "content"."PublishStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "content"."BuildStepKind" AS ENUM ('predict', 'build');

-- CreateEnum
CREATE TYPE "content"."HintLevel" AS ENUM ('nudge', 'concept', 'pseudo', 'line', 'solution');

-- CreateEnum
CREATE TYPE "content"."HintCostKind" AS ENUM ('score', 'token');

-- CreateEnum
CREATE TYPE "content"."BadgeRarity" AS ENUM ('common', 'rare', 'epic', 'legendary');

-- CreateEnum
CREATE TYPE "content"."TrackLevel" AS ENUM ('beginner', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "content"."CheckpointKind" AS ENUM ('mcq', 'short');

-- CreateEnum
CREATE TYPE "app"."Role" AS ENUM ('learner', 'author', 'staff', 'admin');

-- CreateEnum
CREATE TYPE "app"."SubmissionStatus" AS ENUM ('queued', 'running', 'OK', 'WA', 'TLE', 'MLE', 'RE', 'CE', 'XX');

-- CreateEnum
CREATE TYPE "app"."SubmissionKind" AS ENUM ('run', 'submit', 'build', 'gate');

-- CreateEnum
CREATE TYPE "app"."LedgerReason" AS ENUM ('solve', 'build', 'gate', 'unlock', 'hint', 'admin');

-- CreateEnum
CREATE TYPE "app"."LedgerRefType" AS ENUM ('question', 'build_step', 'recipe', 'hint', 'gate', 'admin');

-- CreateEnum
CREATE TYPE "app"."UnlockKind" AS ENUM ('topic', 'tier');

-- CreateEnum
CREATE TYPE "app"."StepStatus" AS ENUM ('seen', 'predicted', 'passed');

-- CreateEnum
CREATE TYPE "app"."LessonStatus" AS ENUM ('started', 'completed');

-- CreateTable
CREATE TABLE "content"."tiers" (
    "id" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,

    CONSTRAINT "tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."topics" (
    "id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."unlock_recipes" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "unlock_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."recipe_items" (
    "id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "token_topic_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "min_difficulty" "content"."Difficulty" NOT NULL DEFAULT 'Easy',

    CONSTRAINT "recipe_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."components" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary_md" TEXT NOT NULL,
    "function_name" TEXT NOT NULL,
    "signature" JSONB NOT NULL,
    "languages" "content"."Language"[],
    "ord" INTEGER NOT NULL,

    CONSTRAINT "components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."component_deps" (
    "component_id" TEXT NOT NULL,
    "depends_on_id" TEXT NOT NULL,

    CONSTRAINT "component_deps_pkey" PRIMARY KEY ("component_id","depends_on_id")
);

-- CreateTable
CREATE TABLE "content"."build_steps" (
    "id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "kind" "content"."BuildStepKind" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt_md" TEXT NOT NULL,
    "difficulty" "content"."Difficulty" NOT NULL DEFAULT 'Easy',
    "payload" JSONB NOT NULL,

    CONSTRAINT "build_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."questions" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" "content"."Difficulty" NOT NULL,
    "statement_md" TEXT NOT NULL,
    "examples" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "function_name" TEXT NOT NULL,
    "signature" JSONB NOT NULL,
    "compare_mode" "content"."CompareMode" NOT NULL DEFAULT 'ordered',
    "starter_code" JSONB NOT NULL,
    "tests" JSONB NOT NULL,
    "reference_solutions" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "editorial_md" TEXT,
    "status" "content"."PublishStatus" NOT NULL DEFAULT 'draft',
    "author_id" TEXT,
    "time_limit_ms" INTEGER NOT NULL DEFAULT 2000,
    "memory_limit_mb" INTEGER NOT NULL DEFAULT 256,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."question_topics" (
    "question_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "question_topics_pkey" PRIMARY KEY ("question_id","topic_id")
);

-- CreateTable
CREATE TABLE "content"."hints" (
    "id" TEXT NOT NULL,
    "question_id" TEXT,
    "build_step_id" TEXT,
    "level" "content"."HintLevel" NOT NULL,
    "body_md" TEXT NOT NULL,
    "cost_kind" "content"."HintCostKind" NOT NULL,
    "cost_amount" INTEGER NOT NULL,

    CONSTRAINT "hints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."gates" (
    "id" TEXT NOT NULL,
    "tier_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "pass_threshold" INTEGER NOT NULL,
    "cooldown_hours" INTEGER NOT NULL,
    "time_limit_minutes" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."gate_questions" (
    "gate_id" TEXT NOT NULL,
    "question_id" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "gate_questions_pkey" PRIMARY KEY ("gate_id","question_id")
);

-- CreateTable
CREATE TABLE "content"."badges" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "rarity" "content"."BadgeRarity" NOT NULL,
    "criteria" JSONB NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."tracks" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "level" "content"."TrackLevel" NOT NULL,
    "tier_id" TEXT,
    "est_hours" DOUBLE PRECISION NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."learn_modules" (
    "id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "learn_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."lessons" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "body_md" TEXT NOT NULL,
    "est_minutes" INTEGER NOT NULL,
    "topic_id" TEXT,
    "related_question_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."checkpoint_questions" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,
    "kind" "content"."CheckpointKind" NOT NULL,
    "prompt_md" TEXT NOT NULL,
    "choices" JSONB,
    "answer" JSONB NOT NULL,
    "explanation_md" TEXT NOT NULL,

    CONSTRAINT "checkpoint_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."library_areas" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "library_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."library_chapters" (
    "id" TEXT NOT NULL,
    "area_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ord" INTEGER NOT NULL,

    CONSTRAINT "library_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content"."library_articles" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "difficulty" "content"."Difficulty" NOT NULL,
    "reading_minutes" INTEGER NOT NULL,
    "idea_md" TEXT NOT NULL,
    "formula" TEXT,
    "code_cpp" TEXT NOT NULL,
    "viz_id" TEXT,
    "applications_md" TEXT NOT NULL,
    "pitfall_md" TEXT NOT NULL,
    "practice_question_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "content"."PublishStatus" NOT NULL DEFAULT 'draft',
    "ord" INTEGER NOT NULL,

    CONSTRAINT "library_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "handle" TEXT NOT NULL,
    "image" TEXT,
    "password_hash" TEXT,
    "email_verified" TIMESTAMPTZ(3),
    "role" "app"."Role" NOT NULL DEFAULT 'learner',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMPTZ(3) NOT NULL
);

-- CreateTable
CREATE TABLE "app"."token_ledger" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "source_difficulty" "content"."Difficulty" NOT NULL,
    "reason" "app"."LedgerReason" NOT NULL,
    "ref_type" "app"."LedgerRefType" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."unlocks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "app"."UnlockKind" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "via_recipe_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unlocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."submissions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "app"."SubmissionKind" NOT NULL,
    "question_id" TEXT,
    "build_step_id" TEXT,
    "gate_attempt_id" TEXT,
    "language" "content"."Language" NOT NULL,
    "code" TEXT NOT NULL,
    "status" "app"."SubmissionStatus" NOT NULL DEFAULT 'queued',
    "total_passed" INTEGER NOT NULL DEFAULT 0,
    "total_tests" INTEGER NOT NULL DEFAULT 0,
    "runtime_us" BIGINT,
    "memory_kb" INTEGER,
    "compile_ms" INTEGER,
    "error" TEXT,
    "percentile" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."test_results" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "hidden" BOOLEAN NOT NULL,
    "runtime_us" INTEGER,
    "memory_kb" INTEGER,
    "input" JSONB,
    "expected" JSONB,
    "actual" JSONB,
    "error" TEXT,
    "explain_on_fail" TEXT,

    CONSTRAINT "test_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."component_versions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "component_id" TEXT NOT NULL,
    "language" "content"."Language" NOT NULL,
    "code" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "submission_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "component_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."step_progress" (
    "user_id" TEXT NOT NULL,
    "build_step_id" TEXT NOT NULL,
    "status" "app"."StepStatus" NOT NULL,
    "answer" JSONB,
    "correct" BOOLEAN,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_progress_pkey" PRIMARY KEY ("user_id","build_step_id")
);

-- CreateTable
CREATE TABLE "app"."hint_uses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "hint_id" TEXT NOT NULL,
    "question_id" TEXT,
    "build_step_id" TEXT,
    "cost_kind" "content"."HintCostKind" NOT NULL,
    "cost_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hint_uses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."gate_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "gate_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "passed_count" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN,
    "next_eligible_at" TIMESTAMPTZ(3),

    CONSTRAINT "gate_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."badge_awards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "awarded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."lesson_progress" (
    "user_id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "status" "app"."LessonStatus" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("user_id","lesson_id")
);

-- CreateTable
CREATE TABLE "app"."checkpoint_attempts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "answers" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkpoint_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."library_progress" (
    "user_id" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_progress_pkey" PRIMARY KEY ("user_id","article_id")
);

-- CreateTable
CREATE TABLE "app"."ai_reviews" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "content_md" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tiers_ord_key" ON "content"."tiers"("ord");

-- CreateIndex
CREATE UNIQUE INDEX "tiers_slug_key" ON "content"."tiers"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "topics_slug_key" ON "content"."topics"("slug");

-- CreateIndex
CREATE INDEX "topics_tier_id_ord_idx" ON "content"."topics"("tier_id", "ord");

-- CreateIndex
CREATE INDEX "unlock_recipes_topic_id_ord_idx" ON "content"."unlock_recipes"("topic_id", "ord");

-- CreateIndex
CREATE INDEX "recipe_items_recipe_id_idx" ON "content"."recipe_items"("recipe_id");

-- CreateIndex
CREATE UNIQUE INDEX "components_slug_key" ON "content"."components"("slug");

-- CreateIndex
CREATE INDEX "components_topic_id_ord_idx" ON "content"."components"("topic_id", "ord");

-- CreateIndex
CREATE INDEX "component_deps_depends_on_id_idx" ON "content"."component_deps"("depends_on_id");

-- CreateIndex
CREATE INDEX "build_steps_component_id_ord_idx" ON "content"."build_steps"("component_id", "ord");

-- CreateIndex
CREATE UNIQUE INDEX "questions_slug_key" ON "content"."questions"("slug");

-- CreateIndex
CREATE INDEX "questions_status_difficulty_idx" ON "content"."questions"("status", "difficulty");

-- CreateIndex
CREATE INDEX "question_topics_topic_id_idx" ON "content"."question_topics"("topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "hints_question_id_level_key" ON "content"."hints"("question_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "hints_build_step_id_level_key" ON "content"."hints"("build_step_id", "level");

-- CreateIndex
CREATE UNIQUE INDEX "gates_tier_id_key" ON "content"."gates"("tier_id");

-- CreateIndex
CREATE INDEX "gate_questions_question_id_idx" ON "content"."gate_questions"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "badges_slug_key" ON "content"."badges"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_slug_key" ON "content"."tracks"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "learn_modules_track_id_slug_key" ON "content"."learn_modules"("track_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_module_id_slug_key" ON "content"."lessons"("module_id", "slug");

-- CreateIndex
CREATE INDEX "checkpoint_questions_module_id_ord_idx" ON "content"."checkpoint_questions"("module_id", "ord");

-- CreateIndex
CREATE UNIQUE INDEX "library_areas_slug_key" ON "content"."library_areas"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "library_chapters_area_id_slug_key" ON "content"."library_chapters"("area_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "library_articles_slug_key" ON "content"."library_articles"("slug");

-- CreateIndex
CREATE INDEX "library_articles_chapter_id_ord_idx" ON "content"."library_articles"("chapter_id", "ord");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "app"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_handle_key" ON "app"."users"("handle");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "app"."accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "app"."accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_key" ON "app"."sessions"("session_token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "app"."sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "app"."verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "app"."verification_tokens"("identifier", "token");

-- CreateIndex
CREATE INDEX "token_ledger_user_id_topic_id_source_difficulty_idx" ON "app"."token_ledger"("user_id", "topic_id", "source_difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "unlocks_user_id_kind_ref_id_key" ON "app"."unlocks"("user_id", "kind", "ref_id");

-- CreateIndex
CREATE INDEX "submissions_user_id_created_at_idx" ON "app"."submissions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "submissions_question_id_language_status_runtime_us_idx" ON "app"."submissions"("question_id", "language", "status", "runtime_us");

-- CreateIndex
CREATE INDEX "submissions_user_id_question_id_idx" ON "app"."submissions"("user_id", "question_id");

-- CreateIndex
CREATE INDEX "submissions_gate_attempt_id_idx" ON "app"."submissions"("gate_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_results_submission_id_idx_key" ON "app"."test_results"("submission_id", "idx");

-- CreateIndex
CREATE UNIQUE INDEX "component_versions_submission_id_key" ON "app"."component_versions"("submission_id");

-- CreateIndex
CREATE INDEX "component_versions_user_id_component_id_language_passed_cre_idx" ON "app"."component_versions"("user_id", "component_id", "language", "passed", "created_at" DESC);

-- CreateIndex
CREATE INDEX "hint_uses_user_id_question_id_idx" ON "app"."hint_uses"("user_id", "question_id");

-- CreateIndex
CREATE INDEX "hint_uses_user_id_build_step_id_idx" ON "app"."hint_uses"("user_id", "build_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "hint_uses_user_id_hint_id_key" ON "app"."hint_uses"("user_id", "hint_id");

-- CreateIndex
CREATE INDEX "gate_attempts_user_id_gate_id_started_at_idx" ON "app"."gate_attempts"("user_id", "gate_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "badge_awards_user_id_badge_id_key" ON "app"."badge_awards"("user_id", "badge_id");

-- CreateIndex
CREATE INDEX "checkpoint_attempts_user_id_module_id_idx" ON "app"."checkpoint_attempts"("user_id", "module_id");

-- CreateIndex
CREATE INDEX "ai_reviews_submission_id_idx" ON "app"."ai_reviews"("submission_id");

-- AddForeignKey
ALTER TABLE "content"."topics" ADD CONSTRAINT "topics_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "content"."tiers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."unlock_recipes" ADD CONSTRAINT "unlock_recipes_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "content"."topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."recipe_items" ADD CONSTRAINT "recipe_items_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "content"."unlock_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."recipe_items" ADD CONSTRAINT "recipe_items_token_topic_id_fkey" FOREIGN KEY ("token_topic_id") REFERENCES "content"."topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."components" ADD CONSTRAINT "components_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "content"."topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."component_deps" ADD CONSTRAINT "component_deps_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "content"."components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."component_deps" ADD CONSTRAINT "component_deps_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "content"."components"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."build_steps" ADD CONSTRAINT "build_steps_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "content"."components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."questions" ADD CONSTRAINT "questions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."question_topics" ADD CONSTRAINT "question_topics_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "content"."questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."question_topics" ADD CONSTRAINT "question_topics_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "content"."topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."hints" ADD CONSTRAINT "hints_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "content"."questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."hints" ADD CONSTRAINT "hints_build_step_id_fkey" FOREIGN KEY ("build_step_id") REFERENCES "content"."build_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."gates" ADD CONSTRAINT "gates_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "content"."tiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."gate_questions" ADD CONSTRAINT "gate_questions_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "content"."gates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."gate_questions" ADD CONSTRAINT "gate_questions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "content"."questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."tracks" ADD CONSTRAINT "tracks_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "content"."tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."learn_modules" ADD CONSTRAINT "learn_modules_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "content"."tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."lessons" ADD CONSTRAINT "lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "content"."learn_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."lessons" ADD CONSTRAINT "lessons_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "content"."topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."checkpoint_questions" ADD CONSTRAINT "checkpoint_questions_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "content"."learn_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."library_chapters" ADD CONSTRAINT "library_chapters_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "content"."library_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content"."library_articles" ADD CONSTRAINT "library_articles_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "content"."library_chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."token_ledger" ADD CONSTRAINT "token_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."token_ledger" ADD CONSTRAINT "token_ledger_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "content"."topics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."unlocks" ADD CONSTRAINT "unlocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."unlocks" ADD CONSTRAINT "unlocks_via_recipe_id_fkey" FOREIGN KEY ("via_recipe_id") REFERENCES "content"."unlock_recipes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "content"."questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_build_step_id_fkey" FOREIGN KEY ("build_step_id") REFERENCES "content"."build_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."submissions" ADD CONSTRAINT "submissions_gate_attempt_id_fkey" FOREIGN KEY ("gate_attempt_id") REFERENCES "app"."gate_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."test_results" ADD CONSTRAINT "test_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."component_versions" ADD CONSTRAINT "component_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."component_versions" ADD CONSTRAINT "component_versions_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "content"."components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."component_versions" ADD CONSTRAINT "component_versions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."step_progress" ADD CONSTRAINT "step_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."step_progress" ADD CONSTRAINT "step_progress_build_step_id_fkey" FOREIGN KEY ("build_step_id") REFERENCES "content"."build_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."hint_uses" ADD CONSTRAINT "hint_uses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."hint_uses" ADD CONSTRAINT "hint_uses_hint_id_fkey" FOREIGN KEY ("hint_id") REFERENCES "content"."hints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."hint_uses" ADD CONSTRAINT "hint_uses_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "content"."questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."hint_uses" ADD CONSTRAINT "hint_uses_build_step_id_fkey" FOREIGN KEY ("build_step_id") REFERENCES "content"."build_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."gate_attempts" ADD CONSTRAINT "gate_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."gate_attempts" ADD CONSTRAINT "gate_attempts_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "content"."gates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."badge_awards" ADD CONSTRAINT "badge_awards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."badge_awards" ADD CONSTRAINT "badge_awards_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "content"."badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "content"."lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."checkpoint_attempts" ADD CONSTRAINT "checkpoint_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."checkpoint_attempts" ADD CONSTRAINT "checkpoint_attempts_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "content"."learn_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."library_progress" ADD CONSTRAINT "library_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."library_progress" ADD CONSTRAINT "library_progress_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "content"."library_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."ai_reviews" ADD CONSTRAINT "ai_reviews_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "app"."submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
