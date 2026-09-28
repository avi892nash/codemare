#!/bin/bash
# codemare-backup-scheduler — the backup container's main process: runs
# codemare-backup every day at BACKUP_AT (HH:MM, UTC; default 03:15).
# BACKUP_ON_START=true also runs one right away (handy after a deploy).
set -uo pipefail
# shellcheck source=lib.sh
. /usr/local/lib/codemare-backup.sh

at="${BACKUP_AT:-03:15}"
[[ "$at" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "BACKUP_AT must be HH:MM (24h, UTC), got '$at'"
install -d -m 0700 "$STATUS"
date -u +%s >"$STATUS/started"
trap 'log "stopping"; exit 0' TERM INT

if [ "${BACKUP_ON_START:-false}" = true ]; then
  codemare-backup || log "backup failed (exit $?)"
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today $at" +%s)
  [ "$next" -gt "$now" ] || next=$(date -u -d "tomorrow $at" +%s)
  log "next backup at $(date -u -d "@$next" +%FT%TZ)"
  sleep $((next - now)) &
  wait $!
  codemare-backup || log "backup failed (exit $?)"
done
