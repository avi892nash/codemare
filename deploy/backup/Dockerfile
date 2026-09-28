# Nightly Postgres backups to a Hetzner Storage Box with restic over SFTP.
#
#   docker build -t codemare-backup deploy/backup
#
# Based on the postgres image so pg_dump/pg_restore always match the server's
# major version. restic comes from its GitHub release, checksum-pinned per
# architecture (amd64 for Hetzner CX/CPX/CCX, arm64 for CAX).
ARG POSTGRES_IMAGE=postgres:16-bookworm
FROM ${POSTGRES_IMAGE}

ARG TARGETARCH
ARG RESTIC_VERSION=0.19.0
ARG RESTIC_SHA256_AMD64=13176fe6d89d4357947a2cd107218ab2873a5f9d8e1ac2d4cd1c8e07e6839c21
ARG RESTIC_SHA256_ARM64=e522ce6bf748d753fee8093e8ec59359972cf5b6bc65fc7c7cf38ae952351d91

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends bzip2 ca-certificates curl openssh-client tini; \
    rm -rf /var/lib/apt/lists/*; \
    case "${TARGETARCH:-amd64}" in \
      amd64) sha="$RESTIC_SHA256_AMD64" ;; \
      arm64) sha="$RESTIC_SHA256_ARM64" ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_${TARGETARCH:-amd64}.bz2"; \
    echo "${sha}  /tmp/restic.bz2" | sha256sum -c -; \
    bunzip2 -c /tmp/restic.bz2 > /usr/local/bin/restic; \
    chmod 0755 /usr/local/bin/restic; \
    rm /tmp/restic.bz2; \
    restic version

COPY lib.sh /usr/local/lib/codemare-backup.sh
COPY backup.sh /usr/local/bin/codemare-backup
COPY restore.sh /usr/local/bin/codemare-restore
COPY scheduler.sh /usr/local/bin/codemare-backup-scheduler
COPY health.sh /usr/local/bin/codemare-backup-health
RUN chmod 0755 /usr/local/bin/codemare-*

ENV RESTIC_CACHE_DIR=/backups/.cache/restic
VOLUME /backups
ENTRYPOINT ["tini", "--"]
CMD ["codemare-backup-scheduler"]
