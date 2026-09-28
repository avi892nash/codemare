-- Integrity guards Prisma's schema language cannot express (spec §2).
-- Prisma does not diff CHECK constraints, triggers or partial indexes, so
-- future `prisma migrate dev` runs leave these alone. Never `db push`.

-- ─── app.token_ledger: append-only ──────────────────────────────────────
-- Balances are SUM(amount); history is never rewritten. A spend is a new
-- negative row, a correction is a new `admin` row.
CREATE FUNCTION "app"."token_ledger_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'app.token_ledger is append-only: % is not allowed', TG_OP
    USING HINT = 'Insert a compensating row (reason ''admin'') instead.';
END;
$$;

CREATE TRIGGER "token_ledger_append_only"
  BEFORE UPDATE OR DELETE ON "app"."token_ledger"
  FOR EACH ROW EXECUTE FUNCTION "app"."token_ledger_append_only"();

-- ─── app.token_ledger: idempotent earns ─────────────────────────────────
-- One positive row per (user, reason, ref, topic, source difficulty): a
-- re-played "first accepted submit" / "first passing build" inserts with
-- ON CONFLICT DO NOTHING and lands nothing. Spends (amount < 0) are exempt.
CREATE UNIQUE INDEX "token_ledger_earn_once_key"
  ON "app"."token_ledger" ("user_id", "reason", "ref_type", "ref_id", "topic_id", "source_difficulty")
  WHERE "amount" > 0;

-- ─── CHECK constraints ──────────────────────────────────────────────────
ALTER TABLE "app"."token_ledger"
  ADD CONSTRAINT "token_ledger_amount_nonzero" CHECK ("amount" <> 0);

ALTER TABLE "app"."users"
  ADD CONSTRAINT "users_handle_format" CHECK ("handle" ~ '^[a-z0-9_]{3,24}$');

ALTER TABLE "content"."recipe_items"
  ADD CONSTRAINT "recipe_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "content"."hints"
  ADD CONSTRAINT "hints_exactly_one_target" CHECK (("question_id" IS NULL) <> ("build_step_id" IS NULL)),
  ADD CONSTRAINT "hints_cost_amount_nonnegative" CHECK ("cost_amount" >= 0);

ALTER TABLE "app"."hint_uses"
  ADD CONSTRAINT "hint_uses_exactly_one_target" CHECK (("question_id" IS NULL) <> ("build_step_id" IS NULL));

ALTER TABLE "content"."gates"
  ADD CONSTRAINT "gates_cooldown_hours_range" CHECK ("cooldown_hours" BETWEEN 12 AND 24);

ALTER TABLE "content"."component_deps"
  ADD CONSTRAINT "component_deps_no_self_dependency" CHECK ("component_id" <> "depends_on_id");

-- ─── app.gate_attempts: at most one running attempt per user and gate ────
CREATE UNIQUE INDEX "gate_attempts_one_running_key"
  ON "app"."gate_attempts" ("user_id", "gate_id")
  WHERE "finished_at" IS NULL;
