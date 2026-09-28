#!/bin/sh
# Entrypoint of the web container (web/Dockerfile).
#
#   1. `prisma migrate deploy` — applies pending migrations (schemas app +
#      content, the ledger trigger, CHECKs, partial indexes). Safe with several
#      replicas: Prisma serializes on an advisory lock. Skip with
#      MIGRATE_ON_START=false (e.g. when a release job migrates instead).
#   2. The content seed, ONLY when SEED_ON_START=true. It upserts every seeded
#      row from prisma/seed/data (or SEED_DIR), which overwrites edits staff
#      made in Directus to those rows (recipes of seeded topics included), so
#      use it for the first deploy or a scratch database, not on every start.
#   3. exec the command (default: the standalone server). Any other command
#      runs after the same steps, e.g. `docker compose run --rm web node prisma/seed/seed.cjs`.
set -eu

log() { echo "codemare-web: $*" >&2; }

: "${DATABASE_URL:?DATABASE_URL is required}"
cd /app/web

if [ "${MIGRATE_ON_START:-true}" = true ]; then
  log "prisma migrate deploy"
  node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
fi

if [ "${SEED_ON_START:-false}" = true ]; then
  log "seeding content from ${SEED_DIR:-prisma/seed/data} (SEED_ON_START=true)"
  node prisma/seed/seed.cjs
fi

exec "$@"
