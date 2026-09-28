#!/bin/sh
# codemare-backup-health — container healthcheck: unhealthy when the last
# successful backup is older than BACKUP_MAX_AGE_HOURS (default 26), or when
# none succeeded that long after the container started.
max=$(( ${BACKUP_MAX_AGE_HOURS:-26} * 3600 ))
now=$(date -u +%s)
if [ -f /backups/status/last-success ]; then
  age=$(( now - $(cat /backups/status/last-success) ))
  [ "$age" -le "$max" ] && exit 0
  echo "last successful backup was $(( age / 3600 ))h ago"
  exit 1
fi
started=$(cat /backups/status/started 2>/dev/null || echo "$now")
[ $(( now - started )) -le "$max" ] && exit 0
echo "no successful backup since the container started"
exit 1
