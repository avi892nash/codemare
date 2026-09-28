# Codemare's Directus: the pinned upstream image plus the codemare extension
# bundle (recipe editor module, content-integrity hooks, supply endpoint) and
# the content-model apply script (run by the `directus-config` service).
#
#   docker build -f admin/Dockerfile -t codemare-directus .     # context = repo root
#
# The context is the repo root because the extension bundles the web app's
# pure token rules (web/lib) and the apply script reads the enum values from
# web/prisma/schema.prisma; admin/Dockerfile.dockerignore keeps it to those.

ARG NODE_IMAGE=node:20.20.2-bookworm-slim
ARG DIRECTUS_IMAGE=directus/directus:12.4.1

FROM ${NODE_IMAGE} AS build
WORKDIR /src/admin
COPY admin/package.json admin/package-lock.json admin/.npmrc ./
RUN npm ci --no-audit --no-fund
COPY web/lib/types.ts /src/web/lib/types.ts
COPY web/lib/server/errors.ts /src/web/lib/server/errors.ts
COPY web/lib/server/rules /src/web/lib/server/rules
COPY web/prisma/schema.prisma /src/web/prisma/schema.prisma
COPY admin/ ./
RUN npm run typecheck && npm test && npm run build

FROM ${DIRECTUS_IMAGE}
COPY --from=build --chown=node:node /src/admin/extensions/codemare/package.json /directus/extensions/directus-extension-codemare/package.json
COPY --from=build --chown=node:node /src/admin/extensions/codemare/dist /directus/extensions/directus-extension-codemare/dist
COPY --from=build /src/admin/dist/apply-content-model.mjs /codemare/apply-content-model.mjs
