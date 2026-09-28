#!/usr/bin/env bash
# Build and roll out the checked-out commit on the VPS, or roll back.
#
#   deploy/deploy.sh                 # build images tagged <git sha>, back up, migrate, restart
#   deploy/deploy.sh rollback <tag>  # switch back to images built earlier for <tag>
#   deploy/deploy.sh status          # current tag, service health, available tags
#
# The tag in use is stored as CODEMARE_VERSION in deploy/.env, so plain
# `docker compose --env-file deploy/.env -f docker-compose.prod.yml ...`
# commands keep addressing the running release.
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
env_file=deploy/.env
[ -f "$env_file" ] || { echo "missing $env_file (copy deploy/.env.example)" >&2; exit 1; }

compose() { docker compose --env-file "$env_file" -f docker-compose.prod.yml "$@"; }
log() { printf '\033[1m==> %s\033[0m\n' "$*"; }

set_version() {
  if grep -q '^CODEMARE_VERSION=' "$env_file"; then
    sed -i.bak "s/^CODEMARE_VERSION=.*/CODEMARE_VERSION=$1/" "$env_file" && rm -f "$env_file.bak"
  else
    printf '\nCODEMARE_VERSION=%s\n' "$1" >>"$env_file"
  fi
  export CODEMARE_VERSION="$1"
}

wait_healthy() {
  local deadline=$((SECONDS + 300)) unhealthy
  while ((SECONDS < deadline)); do
    unhealthy=$(compose ps --format '{{.Service}} {{.Health}}' web backend directus caddy postgres |
      awk '$2 != "healthy" {print $1}')
    [ -z "$unhealthy" ] && { log "all services healthy"; return 0; }
    sleep 5
  done
  echo "not healthy after 5 minutes: $unhealthy" >&2
  compose ps
  for s in $unhealthy; do compose logs --tail 50 "$s"; done
  return 1
}

case "${1:-deploy}" in
  deploy)
    tag=$(git rev-parse --short=12 HEAD)
    [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "working tree has changes; commit or stash first" >&2; exit 1; }
    log "building images for $tag"
    CODEMARE_VERSION=$tag compose build --pull
    if compose ps --status running --services | grep -qx backup; then
      log "pre-deploy backup"
      compose exec -T backup codemare-backup
    fi
    previous=$(grep '^CODEMARE_VERSION=' "$env_file" | cut -d= -f2 || true)
    set_version "$tag"
    log "rolling out $tag (previous: ${previous:-none})"
    compose up -d --remove-orphans
    wait_healthy
    log "deployed $tag; roll back with: deploy/deploy.sh rollback ${previous:-<tag>}"
    ;;
  rollback)
    tag=${2:?usage: deploy/deploy.sh rollback <tag>}
    for image in web backend directus backup; do
      docker image inspect "codemare/$image:$tag" >/dev/null 2>&1 || { echo "codemare/$image:$tag not found locally" >&2; exit 1; }
    done
    log "rolling back to $tag (migrations are forward-only: see deploy/README.md, Rollback)"
    set_version "$tag"
    compose up -d --remove-orphans
    wait_healthy
    ;;
  status)
    grep '^CODEMARE_VERSION=' "$env_file"
    compose ps
    docker image ls codemare/web --format '{{.Tag}}\t{{.CreatedSince}}'
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 2
    ;;
esac
