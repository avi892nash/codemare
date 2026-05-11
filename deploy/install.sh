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
