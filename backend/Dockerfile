# Codemare compile service (backend/): Node 20 + python3 + Temurin JDK 21 +
# g++ + Go + isolate, running the built Express server.
#
#   docker build -f backend/Dockerfile -t codemare-backend .     # context = repo root
#
# The build context is the repo root because the npm workspace lockfile
# (package-lock.json) lives there; backend/Dockerfile.dockerignore trims it.
#
# RUNTIME REQUIREMENTS (deploy/README.md, "isolate, cgroups and privileged"):
#   · privileged: true — isolate creates mount/pid/net/ipc/uts namespaces and
#     bind mounts for every box and writes per-box cgroups (memory.max,
#     cpuset.cpus, cgroup.kill). An unprivileged container has /sys/fs/cgroup
#     mounted read-only and lacks CAP_SYS_ADMIN, so isolate cannot run there.
#   · cgroup v2 on the host and a private cgroup namespace (Docker's default
#     on cgroup v2). deploy/backend/docker-entrypoint.sh moves the container's
#     processes into a leaf cgroup and delegates cpuset/memory/pids to
#     /sys/fs/cgroup/isolate, which it configures as isolate's cg_root.
#   · The server runs as the unprivileged `codemare` user; only the setuid
#     isolate binary gains root, exactly as on the old systemd host.
#
# Toolchain layout matters inside the sandbox: a box sees only /bin, /lib*,
# /usr, /dev, /proc and a private /tmp, with an empty environment (no PATH,
# no HOME), so `/usr/bin/env <tool>` searches the default /bin:/usr/bin.
# Every toolchain therefore lives under /usr and is linked into /usr/bin
# directly (never via /etc/alternatives, which a box cannot see). That is also
# why the JDK is Temurin's self-contained tree rather than Debian's openjdk,
# whose conf/ and lib/jvm.cfg are symlinks into /etc.

ARG NODE_IMAGE=node:20.20.2-bookworm-slim
ARG GO_IMAGE=golang:1.27.1-bookworm
ARG JDK_IMAGE=eclipse-temurin:21.0.12.1_1-jdk

# isolate is not in Debian's archive: build a pinned release from source.
ARG ISOLATE_VERSION=2.7
ARG ISOLATE_SHA256=2a2102aaf10efdb1d2eedcaaafe343a838407e2e21bca8594f8d74cf22915628

FROM ${GO_IMAGE} AS go
FROM ${JDK_IMAGE} AS jdk

# ── isolate ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS isolate
ARG ISOLATE_VERSION
ARG ISOLATE_SHA256
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gcc make libc6-dev libcap-dev libseccomp-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src/isolate
RUN curl -fsSL -o /tmp/isolate.tar.gz "https://github.com/ioi/isolate/archive/refs/tags/v${ISOLATE_VERSION}.tar.gz" \
 && echo "${ISOLATE_SHA256}  /tmp/isolate.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/isolate.tar.gz --strip-components=1 \
 && make isolate \
 && ./isolate --version

# ── build the TypeScript server ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
# Workspace manifests first so the dependency layer caches across source edits.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --workspace=backend --include-workspace-root=false --no-audit --no-fund
COPY backend/ backend/
RUN npm run build --workspace=backend

# ── production dependencies only ────────────────────────────────────────────
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY web/package.json web/
RUN npm ci --workspace=backend --include-workspace-root=false --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && mkdir -p backend/node_modules

# ── runtime ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates python3 g++ libcap2 libseccomp2 \
 && rm -rf /var/lib/apt/lists/*

# Toolchains, each reachable from the sandbox's default search path.
# (The server warms its own shared Go build cache at startup; see
# backend/src/services/sandbox/goToolchain.ts.)
COPY --from=go /usr/local/go /usr/local/go
COPY --from=jdk /opt/java/openjdk /usr/local/lib/jvm/temurin-21
COPY deploy/backend/gxx-wrapper.sh /usr/local/lib/codemare/g++
RUN set -eux; \
    ln -sf /usr/local/bin/node /usr/bin/node; \
    for b in go gofmt; do ln -sf "/usr/local/go/bin/$b" "/usr/bin/$b"; done; \
    for b in java javac jar jshell; do ln -sf "/usr/local/lib/jvm/temurin-21/bin/$b" "/usr/bin/$b"; done; \
    # g++ in an environment-less box: see deploy/backend/gxx-wrapper.sh.
    test "$(readlink /usr/bin/g++)" = g++-12; \
    chmod 0755 /usr/local/lib/codemare/g++; \
    ln -sf /usr/local/lib/codemare/g++ /usr/bin/g++; \
    # Never download toolchains or modules from inside the container.
    printf '\nGOTOOLCHAIN=local\nGOPROXY=off\n' >> /usr/local/go/go.env; \
    node --version; python3 --version; env -i /usr/bin/env g++ --version | head -n1; java -version; go version

COPY --from=isolate /src/isolate/isolate /usr/local/bin/isolate
COPY --from=isolate /src/isolate/isolate-check-environment /usr/local/sbin/isolate-check-environment
RUN chmod 4755 /usr/local/bin/isolate \
 && install -d -m 0755 /usr/local/etc /var/local/lib/isolate \
 && groupadd --system --gid 10001 codemare \
 && useradd --system --uid 10001 --gid codemare --home-dir /app --no-create-home --shell /usr/sbin/nologin codemare

WORKDIR /app
COPY --from=prod-deps /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
# Packages the lockfile nests under the workspace (e.g. backend/node_modules/zod).
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY deploy/backend/docker-entrypoint.sh /usr/local/bin/codemare-backend-entrypoint

ENV NODE_ENV=production \
    PORT=4000 \
    SANDBOX_MODE=isolate
WORKDIR /app/backend
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
ENTRYPOINT ["codemare-backend-entrypoint"]
CMD ["node", "dist/server.js"]
