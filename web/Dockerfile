# Codemare web app (Next.js 15 standalone server + Prisma).
#
#   docker build -f web/Dockerfile -t codemare-web .     # context = repo root
#
# The build context is the repo root because the npm workspace lockfile
# lives there; web/Dockerfile.dockerignore trims it to what the build needs.
#
# At start the entrypoint (deploy/web/docker-entrypoint.sh) runs
# `prisma migrate deploy`, seeds the content only when SEED_ON_START=true, and
# then execs the standalone server. Prisma's engines are the linux ones of the
# build platform (the build runs on the same Debian base as the runtime), so
# build the image on/for the architecture you deploy to (amd64 on Hetzner CX/
# CPX/CCX, arm64 on CAX), or with `docker buildx --platform`.

ARG NODE_IMAGE=node:20.20.2-bookworm-slim

FROM ${NODE_IMAGE} AS base
# Prisma's engines link against OpenSSL 3; `openssl` lets Prisma detect it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1

# ── dependencies (dev deps included: next build needs them) ─────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY backend/package.json backend/
RUN npm ci --workspace=web --include-workspace-root=false --no-audit --no-fund

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
COPY web/ web/
WORKDIR /app/web
RUN npx prisma generate
# Placeholders for the build only: `next build` runs with NODE_ENV=production
# and loads server modules that validate their env at import time (the
# compile client refuses a missing INTERNAL_TOKEN). None of them is baked into
# the runtime image; real values come from the container environment.
RUN NEXT_OUTPUT=standalone \
    INTERNAL_TOKEN=0000000000000000000000000000000000000000000000000000000000000000 \
    AUTH_SECRET=build-time-placeholder-not-a-secret \
    DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    npm run build
# The seed CLI as one CommonJS file (only @prisma/client stays external), so
# the runtime needs neither tsx nor the TypeScript sources. import.meta.url is
# rebound to the bundle's own location, which keeps the default seed dir
# (prisma/seed/data, next to the bundle) working.
RUN npx esbuild prisma/seed/index.ts --bundle --platform=node --target=node20 --format=cjs \
      --external:@prisma/client \
      --define:import.meta.url=__seedImportMetaUrl \
      "--banner:js=const __seedImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" \
      --outfile=prisma/seed/seed.cjs --log-level=warning

# ── runtime ─────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone server (traced node_modules included) + the assets it does not copy.
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
# Prisma CLI + engines and the generated client, for `migrate deploy` and the seed.
COPY --from=build /app/web/node_modules/prisma ./web/node_modules/prisma
COPY --from=build /app/web/node_modules/@prisma ./web/node_modules/@prisma
COPY --from=build /app/web/node_modules/.prisma ./web/node_modules/.prisma
COPY --from=build /app/web/prisma/schema.prisma ./web/prisma/schema.prisma
COPY --from=build /app/web/prisma/migrations ./web/prisma/migrations
COPY --from=build /app/web/prisma/seed/seed.cjs ./web/prisma/seed/seed.cjs
COPY --from=build /app/web/prisma/seed/data ./web/prisma/seed/data
COPY --from=build /app/web/prisma/seed/fixtures ./web/prisma/seed/fixtures
COPY deploy/web/docker-entrypoint.sh /usr/local/bin/codemare-web-entrypoint

WORKDIR /app/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/auth/providers').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["codemare-web-entrypoint"]
CMD ["node", "server.js"]
