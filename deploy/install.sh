#!/usr/bin/env bash
# Provision a fresh Linux VM (Debian 12 / Ubuntu 22.04+) to run the codemare
# backend with the isolate sandbox. Idempotent.
#
# Usage: sudo bash deploy/install.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

# 1. Verify cgroups v2 (required by isolate --cg)
fs_type=$(stat -fc %T /sys/fs/cgroup)
if [[ "$fs_type" != "cgroup2fs" ]]; then
  echo "ERROR: cgroups v2 not active (saw '$fs_type'). Boot with systemd.unified_cgroup_hierarchy=1 or upgrade the host." >&2
  exit 1
fi

# 2. Install runtime + sandbox dependencies.
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  isolate \
  ca-certificates \
  curl \
  python3 \
  default-jdk-headless \
  g++ \
  make

# 3. Node 20 from NodeSource if not already present.
if ! command -v node >/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# 3b. Go toolchain (>= 1.22) for the Go judge. The distro package is used when
#     it is new enough (Ubuntu 24.04 ships 1.22); Debian 12 (1.19) and Ubuntu
#     22.04 (1.18) get the latest official release from go.dev instead,
#     checksum-verified, in /usr/local/go. Either way `go` ends up on the
#     service's PATH and under /usr, which isolate boxes can see; the backend
#     warms its build cache at startup (see backend/DEPLOYMENT.md).
GO_MIN_MINOR=22
go_minor() { "$1" version 2>/dev/null | sed -n 's/.*go1\.\([0-9][0-9]*\).*/\1/p'; }
go_ok() {
  local bin minor
  bin=$(command -v go || true)
  [[ -n "$bin" ]] || return 1
  minor=$(go_minor "$bin")
  [[ -n "$minor" && "$minor" -ge "$GO_MIN_MINOR" ]]
}
if ! go_ok; then
  # Candidate looks like "2:1.22~2build1" → minor version 22.
  candidate=$(apt-cache policy golang-go 2>/dev/null | sed -n 's/^ *Candidate: *//p')
  cand_minor=$(echo "$candidate" | sed -n 's/^[0-9]*:\{0,1\}1\.\([0-9][0-9]*\).*/\1/p')
  if [[ -n "$cand_minor" && "$cand_minor" -ge "$GO_MIN_MINOR" ]]; then
    apt-get install -y --no-install-recommends golang-go
  else
    go_arch=$(dpkg --print-architecture) # amd64 | arm64
    go_release=$(curl -fsSL 'https://go.dev/dl/?mode=json' | python3 -c '
import json, sys
arch = sys.argv[1]
latest = json.load(sys.stdin)[0]
f = next(f for f in latest["files"] if f["os"] == "linux" and f["arch"] == arch and f["kind"] == "archive")
print(f["filename"], f["sha256"])
' "$go_arch")
    go_file=${go_release% *}
    go_sha=${go_release#* }
    [[ -n "$go_file" && -n "$go_sha" && "$go_file" != "$go_sha" ]] || {
      echo "ERROR: could not resolve a Go release for linux/$go_arch from go.dev" >&2
      exit 1
    }
    go_tmp=$(mktemp -d)
    curl -fsSL -o "$go_tmp/$go_file" "https://go.dev/dl/$go_file"
    echo "$go_sha  $go_tmp/$go_file" | sha256sum -c -
    rm -rf /usr/local/go
    tar -C /usr/local -xzf "$go_tmp/$go_file"
    rm -rf "$go_tmp"
    ln -sf /usr/local/go/bin/go /usr/local/bin/go
    ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
  fi
fi
go_ok || { echo "ERROR: Go >= 1.$GO_MIN_MINOR is not available after install" >&2; exit 1; }
go version

# 4. Service user, install dirs, log dir.
id -u codemare >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin codemare
install -d -o codemare -g codemare /opt/codemare/backend
install -d -o codemare -g codemare /var/log/codemare

# 5. Secrets directory. The systemd unit reads INTERNAL_TOKEN from
#    /etc/codemare/env. We generate one if it doesn't exist; rotate by
#    overwriting and restarting both this service and the caller (Next.js).
install -d -o root -g codemare -m 0750 /etc/codemare
if [[ ! -f /etc/codemare/env ]]; then
  token=$(openssl rand -hex 32)
  cat > /etc/codemare/env <<EOF
# Codemare backend secrets — keep mode 0640. Rotate by overwriting both this
# file AND the INTERNAL_TOKEN on the Next.js caller, then restarting both.
INTERNAL_TOKEN=${token}
EOF
  chown root:codemare /etc/codemare/env
  chmod 0640 /etc/codemare/env
  echo "Generated /etc/codemare/env with a fresh INTERNAL_TOKEN."
fi

# 6. Drop the systemd unit into place.
script_dir="$(cd "$(dirname "$0")" && pwd)"
install -m 0644 "$script_dir/codemare-backend.service" /etc/systemd/system/codemare-backend.service
systemctl daemon-reload

echo
echo "Provisioning complete. Next steps:"
echo "  1. Sync release artifacts: bash deploy/release.sh <vm-host>"
echo "  2. Start service:          systemctl enable --now codemare-backend"
echo "  3. Tail logs:              journalctl -u codemare-backend -f"
echo
echo "Internal token (copy this to the Next.js INTERNAL_TOKEN):"
grep '^INTERNAL_TOKEN=' /etc/codemare/env
