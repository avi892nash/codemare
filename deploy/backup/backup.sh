#!/bin/bash
# codemare-backup — one backup run (the scheduler calls this nightly; run it
# by hand with `docker compose ... exec backup codemare-backup`).
#
#   1. pg_dump the whole database in custom format (-Fc), uncompressed so
#      restic can deduplicate night over night (restic compresses with zstd
#      and encrypts before anything leaves the server). "Whole database"
#      means app + content plus public._prisma_migrations (without it a
#      restore could not be migrated forward) and the directus schema (users,
#      roles, the applied content model).
#   2. Verify the dump's table of contents (pg_restore --list) and write a
#      manifest (row counts, applied migrations) for restore checks.
#   3. restic backup -> forget --prune (BACKUP_KEEP_DAILY/WEEKLY/MONTHLY) ->
#      check (structure daily; a data sample on Sundays).
#   4. Record success in /backups/status and ping BACKUP_PING_URL, if set.
set -Eeuo pipefail
# shellcheck source=lib.sh
. /usr/local/lib/codemare-backup.sh

: "${PGDATABASE:?PGDATABASE is not set}"
started=$(date -u +%s)
install -d -m 0700 "$STAGING" "$STATUS"

ping() { # $1 = "" (success) | "/fail" | "/start"
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_PING_URL%/}$1" || log "ping ${BACKUP_PING_URL%/}$1 failed"
}
trap 'log "backup FAILED (line $LINENO)"; ping /fail' ERR
ping /start

restic_setup
if ! run_restic cat config >/dev/null 2>&1; then
  log "initializing restic repository $RESTIC_REPOSITORY"
  run_restic init
fi

log "pg_dump $PGDATABASE@${PGHOST:-localhost}"
pg_dump --format=custom --compress=0 --file="$STAGING/$DUMP_NAME.tmp"
pg_restore --list "$STAGING/$DUMP_NAME.tmp" >/dev/null
mv -f "$STAGING/$DUMP_NAME.tmp" "$STAGING/$DUMP_NAME"
pg_dumpall --globals-only --no-role-passwords --file="$STAGING/globals.sql"

psql --no-psqlrc -X -qAt -v ON_ERROR_STOP=1 >"$STAGING/manifest.txt" <<'SQL'
SELECT 'database=' || current_database();
SELECT 'server_version=' || current_setting('server_version');
SELECT 'dumped_at=' || to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
SELECT 'migrations=' || coalesce(string_agg(migration_name, ',' ORDER BY migration_name), '')
  FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT 'rows.' || n || '=' || c FROM (
  SELECT 'content.questions' AS n, count(*) AS c FROM content.questions UNION ALL
  SELECT 'content.topics', count(*) FROM content.topics UNION ALL
  SELECT 'content.unlock_recipes', count(*) FROM content.unlock_recipes UNION ALL
  SELECT 'content.recipe_items', count(*) FROM content.recipe_items UNION ALL
  SELECT 'app.users', count(*) FROM app.users UNION ALL
  SELECT 'app.submissions', count(*) FROM app.submissions UNION ALL
  SELECT 'app.token_ledger', count(*) FROM app.token_ledger
) t ORDER BY n;
SQL
size=$(du -h "$STAGING/$DUMP_NAME" | cut -f1)
log "dump ok ($size); uploading"

run_restic backup --host "$RESTIC_HOST_TAG" --tag nightly --tag "db=$PGDATABASE" "$STAGING"
run_restic forget --host "$RESTIC_HOST_TAG" --tag nightly --prune \
  --keep-daily "${BACKUP_KEEP_DAILY:-14}" \
  --keep-weekly "${BACKUP_KEEP_WEEKLY:-8}" \
  --keep-monthly "${BACKUP_KEEP_MONTHLY:-6}"
if [ "$(date -u +%u)" = 7 ] || [ "${BACKUP_FULL_CHECK:-false}" = true ]; then
  run_restic check --read-data-subset="${BACKUP_CHECK_SUBSET:-5%}"
else
  run_restic check
fi

date -u +%s >"$STATUS/last-success"
log "backup complete in $(( $(date -u +%s) - started ))s"
ping ""
