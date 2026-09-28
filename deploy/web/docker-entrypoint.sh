#!/bin/sh
# Entrypoint of the web container (web/Dockerfile).
#
#   1. `prisma migrate deploy` — applies pending migrations (schemas app +
#      content, the ledger trigger, CHECKs, partial indexes). Safe with several
#      replicas: Prisma serializes on an advisory lock. Skip with
#      MIGRATE_ON_START=false (e.g. when a release job migrates instead).
#   2. The content seed, ONLY when SEED_ON_START=true, in SEED_MODE (default
#      here: insert-missing). insert-missing creates only content whose slug
#      is not in the database yet (with what it owns) and never changes an
#      existing row, so staff edits made in Directus survive; it also fills an
#      empty database completely (first deploy). SEED_MODE=upsert resets every
#      seeded row to prisma/seed/data (or SEED_DIR) instead — edits are lost.
#   3. exec the command (default: the standalone server). Any other command
#      runs after the same steps and sees the same SEED_MODE default, e.g.
#      `docker compose run --rm web node prisma/seed/seed.cjs` inserts what is
#      missing; add `--mode upsert` (or -e SEED_MODE=upsert) to reset.
set -eu

log() { echo "codemare-web: $*" >&2; }

: "${DATABASE_URL:?DATABASE_URL is required}"
# The seed CLI's own default is upsert (development); in this image it is insert-missing.
: "${SEED_MODE:=insert-missing}"
export SEED_MODE
cd /app/web

if [ "${MIGRATE_ON_START:-true}" = true ]; then
  log "prisma migrate deploy"
  node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
fi

if [ "${SEED_ON_START:-false}" = true ]; then
  log "seeding content from ${SEED_DIR:-prisma/seed/data} (SEED_ON_START=true, SEED_MODE=${SEED_MODE})"
  node prisma/seed/seed.cjs
fi

exec "$@"
