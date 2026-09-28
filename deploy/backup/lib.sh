# Shared by codemare-backup and codemare-restore (sourced, not executed).
#
# Connection settings come from the environment:
#   PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE     libpq, as usual
#   RESTIC_REPOSITORY RESTIC_PASSWORD             the restic repository
#   BACKUP_SSH_HOST BACKUP_SSH_USER BACKUP_SSH_PORT   when set, restic talks SFTP
#       through ssh with the key in /run/secrets/backup_ssh_key and the pinned
#       host key in /run/secrets/backup_known_hosts (StrictHostKeyChecking=yes)

STAGING=/backups/staging
STATUS=/backups/status
DUMP_NAME=codemare.dump
RESTIC_HOST_TAG=codemare

log() { printf '%s codemare-backup: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# Populates RESTIC_ARGS (extra restic options) for the SFTP transport.
restic_setup() {
  : "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is not set}"
  : "${RESTIC_PASSWORD:?RESTIC_PASSWORD is not set}"
  export RESTIC_REPOSITORY RESTIC_PASSWORD
  RESTIC_ARGS=()
  if [ -n "${BACKUP_SSH_HOST:-}" ]; then
    : "${BACKUP_SSH_USER:?BACKUP_SSH_USER is not set}"
    local key=/run/secrets/backup_ssh_key known=/run/secrets/backup_known_hosts
    [ -r "$key" ] || die "SSH key $key is missing (see deploy/README.md, Backups)"
    [ -r "$known" ] || die "known_hosts $known is missing (ssh-keyscan -p ${BACKUP_SSH_PORT:-23} $BACKUP_SSH_HOST)"
    # ssh refuses keys other users can read; the bind mount keeps host modes.
    install -d -m 0700 /root/.ssh
    install -m 0600 "$key" /root/.ssh/backup_key
    RESTIC_ARGS+=(-o "sftp.command=ssh -p ${BACKUP_SSH_PORT:-23} -i /root/.ssh/backup_key -o UserKnownHostsFile=$known -o StrictHostKeyChecking=yes -o BatchMode=yes -o ServerAliveInterval=60 ${BACKUP_SSH_USER}@${BACKUP_SSH_HOST} -s sftp")
  fi
}

run_restic() { restic "${RESTIC_ARGS[@]}" "$@"; }
