#!/usr/bin/env bash
# Build the backend locally and rsync the release to a target VM. Restarts the
# systemd service after sync.
#
# Usage: deploy/release.sh <ssh-host>
#   The remote host must have run deploy/install.sh first.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <ssh-host>" >&2
  exit 1
fi

remote="$1"
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
backend_dir="$repo_root/backend"

echo "==> Building backend"
cd "$backend_dir"
npm ci --omit=dev=false  # build needs typescript devDeps
npm run build

echo "==> Pruning to runtime deps"
# Use a staging area so we don't trash dev node_modules locally.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cp -r dist "$stage/dist"
cp package.json package-lock.json "$stage/"
( cd "$stage" && npm ci --omit=dev )

echo "==> Syncing to $remote:/opt/codemare/backend/"
rsync -az --delete \
  --include='dist/***' \
  --include='node_modules/***' \
  --include='package.json' \
  --include='package-lock.json' \
  --exclude='*' \
  "$stage/" "$remote:/opt/codemare/backend/"

echo "==> Restarting service"
ssh "$remote" 'sudo systemctl restart codemare-backend && sudo systemctl is-active codemare-backend'

echo "Done."
