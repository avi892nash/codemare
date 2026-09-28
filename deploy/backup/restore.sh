#!/bin/bash
# codemare-restore — list, fetch and restore backups made by codemare-backup.
#
#   codemare-restore snapshots
#   codemare-restore fetch   [SNAPSHOT] [DIR]        # default: latest -> /backups/restore
#   codemare-restore restore TARGET_DB [SNAPSHOT] [--replace]
#   codemare-restore restore-file TARGET_DB DUMP [--replace]
#
# restore/restore-file need a SUPERUSER connection (PGUSER=postgres and its
# password): they create TARGET_DB owned by `codemare` and pg_restore into it
# with the original owners, so the roles from deploy/postgres/db-init.sql
# must exist (they do on any server where the stack has run once).
# TARGET_DB must not exist unless --replace is given, which drops it first
# (WITH FORCE: stop web, migrate and directus before replacing the live db).
# Afterwards the row counts are compared with the snapshot's manifest.
set -Eeuo pipefail
# shellcheck source=lib.sh
. /usr/local/lib/codemare-backup.sh

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
[ $# -ge 1 ] || usage

q() { psql --no-psqlrc -X -qAt -v ON_ERROR_STOP=1 -d postgres "$@"; }

fetch() { # $1 snapshot, $2 dir -> prints the dump path
  local snapshot="${1:-latest}" dir="${2:-/backups/restore}"
  restic_setup
  rm -rf "$dir"
  install -d -m 0700 "$dir"
  log "restoring snapshot $snapshot of $RESTIC_REPOSITORY into $dir"
  run_restic restore "$snapshot" --host "$RESTIC_HOST_TAG" --target "$dir" --include "$STAGING" >&2
  [ -f "$dir$STAGING/$DUMP_NAME" ] || die "snapshot $snapshot has no $STAGING/$DUMP_NAME"
  echo "$dir$STAGING/$DUMP_NAME"
}

restore_file() { # $1 target db, $2 dump file, $3 replace flag
  local db="$1" dump="$2" replace="${3:-}"
  [[ "$db" =~ ^[a-z_][a-z0-9_]*$ ]] || die "database name must match [a-z_][a-z0-9_]*"
  [ -f "$dump" ] || die "no such dump: $dump"
  [ "$(q -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user')" = t ] ||
    die "restore needs a superuser connection (PGUSER=postgres, PGPASSWORD=\$POSTGRES_PASSWORD)"
  for role in codemare directus codemare_backup; do
    [ "$(q -c "SELECT count(*) FROM pg_roles WHERE rolname = '$role'")" = 1 ] ||
      die "role $role is missing; run the db-init service first"
  done
  pg_restore --list "$dump" >/dev/null || die "$dump is not a readable pg_dump archive"

  if [ "$(q -c "SELECT count(*) FROM pg_database WHERE datname = '$db'")" = 1 ]; then
    [ "$replace" = --replace ] || die "database $db exists; pass --replace to drop and recreate it"
    log "dropping database $db (--replace)"
    q -c "DROP DATABASE \"$db\" WITH (FORCE)"
  fi
  log "creating database $db"
  q -c "CREATE DATABASE \"$db\" OWNER codemare"
  q -c "REVOKE ALL ON DATABASE \"$db\" FROM PUBLIC"
  q -c "GRANT CONNECT, TEMPORARY ON DATABASE \"$db\" TO codemare, directus, codemare_backup"

  log "pg_restore into $db"
  pg_restore --dbname="$db" --exit-on-error --jobs=4 "$dump"

  local manifest ok=1 line name want got
  manifest="$(dirname "$dump")/manifest.txt"
  if [ -f "$manifest" ]; then
    log "restored; comparing row counts with the manifest ($(grep '^dumped_at=' "$manifest" | cut -d= -f2))"
    while IFS= read -r line; do
      case "$line" in rows.*) ;; *) continue ;; esac
      name="${line#rows.}"; want="${name#*=}"; name="${name%%=*}"
      got=$(psql --no-psqlrc -X -qAt -d "$db" -c "SELECT count(*) FROM $name" </dev/null)
      if [ "$got" = "$want" ]; then log "  $name: $got"; else log "  $name: $got (manifest: $want) MISMATCH"; ok=0; fi
    done <"$manifest"
  else
    log "restored; no manifest next to the dump, skipping the row-count comparison"
  fi
  local migrations
  migrations=$(psql --no-psqlrc -X -qAt -d "$db" -c "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL")
  log "  _prisma_migrations: $migrations applied"
  [ "$ok" = 1 ] || die "row counts differ from the manifest"
  log "restore of $db complete"
}

cmd="$1"; shift
case "$cmd" in
  snapshots)
    restic_setup
    run_restic snapshots --host "$RESTIC_HOST_TAG"
    ;;
  fetch)
    fetch "${1:-latest}" "${2:-/backups/restore}"
    ;;
  restore)
    [ $# -ge 1 ] || usage
    db="$1"; shift
    snapshot=latest; replace=
    for arg in "$@"; do
      if [ "$arg" = --replace ]; then replace=--replace; else snapshot="$arg"; fi
    done
    dump=$(fetch "$snapshot" /backups/restore)
    restore_file "$db" "$dump" "$replace"
    ;;
  restore-file)
    [ $# -ge 2 ] || usage
    restore_file "$1" "$2" "${3:-}"
    ;;
  *) usage ;;
esac
