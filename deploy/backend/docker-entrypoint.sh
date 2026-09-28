#!/bin/sh
# Entrypoint of the compile-service container (backend/Dockerfile).
#
# Starts as root, prepares what isolate needs, then drops to the unprivileged
# `codemare` user and execs the server:
#
#   1. cgroup v2 delegation. The container has a private cgroup namespace, so
#      /sys/fs/cgroup is "its" root. cgroup v2 forbids a cgroup that has
#      processes from delegating controllers to children, so every process is
#      moved into /sys/fs/cgroup/init first; then cpuset/memory/pids are
#      enabled for children and /sys/fs/cgroup/isolate is created as
#      isolate's cg_root (it creates box-<id> under it per run).
#   2. /usr/local/etc/isolate: box root, uid/gid range, cg_root and, unless
#      ISOLATE_CPU_PINNING=off, one CPU per box (box N -> Nth CPU modulo the
#      CPUs this container may use). isolate pins through per-box cpusets in
#      its config file; it has no command-line flag for it.
#      syscall_flags (ISOLATE_SYSCALL_FLAGS, default 65531) keeps isolate's
#      seccomp restrictions except flag 4, file locks: `go build` takes
#      flock()s on its build cache and exits 1 without them. The cost is a
#      lock-based side channel between boxes running at the same moment.
#      Set 65535 once the compile service passes --syscalls to Go compile
#      boxes only (isolate >= 2.7 supports that per run).
#   3. A smoke test (init, run, cleanup of one box as the service user), so a
#      host that cannot sandbox fails here, loudly, not at the first submission.
#
# SANDBOX_MODE=local skips all of this (unsandboxed dev adapter; the server
# itself refuses it when NODE_ENV=production).
set -eu

CG=/sys/fs/cgroup
ISOLATE_CG="$CG/isolate"
CONF=/usr/local/etc/isolate
RUN_AS="${RUN_AS:-codemare}"
PINNING="${ISOLATE_CPU_PINNING:-round-robin}"
NUM_BOXES="${ISOLATE_NUM_BOXES:-1000}"
SYSCALL_FLAGS="${ISOLATE_SYSCALL_FLAGS:-65531}"
MODE=$(printf '%s' "${SANDBOX_MODE:-isolate}" | tr '[:upper:]' '[:lower:]')

log() { echo "codemare-backend: $*" >&2; }
die() { log "FATAL: $*"; exit 1; }
as_user() { setpriv --reuid="$RUN_AS" --regid="$RUN_AS" --init-groups -- "$@"; }

# "0-3,6,8-9" -> "0 1 2 3 6 8 9"
expand_cpus() {
  printf '%s\n' "$1" | tr ',' '\n' | while IFS=- read -r lo hi; do
    [ -n "$lo" ] || continue
    if [ -n "${hi:-}" ]; then seq "$lo" "$hi"; else echo "$lo"; fi
  done | tr '\n' ' '
}

setup_cgroups() {
  [ "$(stat -fc %T "$CG" 2>/dev/null)" = cgroup2fs ] ||
    die "$CG is not a cgroup v2 mount. isolate 2.x needs a cgroup v2 host (systemd.unified_cgroup_hierarchy=1)."
  mkdir -p "$CG/init" 2>/dev/null ||
    die "cannot create cgroups under $CG (read-only). Run this container with privileged: true."

  # Evacuate the namespace root; retry because processes may fork meanwhile.
  for _ in 1 2 3 4 5; do
    procs=$(cat "$CG/cgroup.procs")
    [ -n "$procs" ] || break
    for p in $procs; do echo "$p" >"$CG/init/cgroup.procs" 2>/dev/null || true; done
  done

  want="memory"
  [ "$PINNING" = off ] || want="$want cpuset"
  avail=" $(cat "$CG/cgroup.controllers") "
  for c in $want; do
    case "$avail" in *" $c "*) ;; *) die "cgroup controller '$c' is not available to this container (have:$avail)" ;; esac
  done
  case "$avail" in *" pids "*) want="$want pids" ;; esac

  for c in $want; do echo "+$c" >"$CG/cgroup.subtree_control"; done
  mkdir -p "$ISOLATE_CG"
  for c in $want; do echo "+$c" >"$ISOLATE_CG/cgroup.subtree_control"; done
}

write_config() {
  case "$SYSCALL_FLAGS" in '' | *[!0-9]*) die "ISOLATE_SYSCALL_FLAGS must be a number (isolate man page), got '$SYSCALL_FLAGS'" ;; esac
  {
    echo "# Written by codemare-backend-entrypoint on every start; edits are lost."
    echo "box_root = /var/local/lib/isolate"
    echo "lock_root = /run/isolate/locks"
    echo "cg_root = $ISOLATE_CG"
    echo "first_uid = 60000"
    echo "first_gid = 60000"
    echo "num_boxes = $NUM_BOXES"
    echo "syscall_flags = $SYSCALL_FLAGS"
    if [ "$PINNING" != off ]; then
      cpus=$(expand_cpus "$(cat "$CG/cpuset.cpus.effective")")
      [ -n "$cpus" ] || die "empty $CG/cpuset.cpus.effective"
      i=0
      while [ "$i" -lt "$NUM_BOXES" ]; do
        for cpu in $cpus; do
          [ "$i" -lt "$NUM_BOXES" ] || break
          echo "box$i.cpus = $cpu"
          i=$((i + 1))
        done
      done
    fi
  } >"$CONF"
  chmod 0644 "$CONF"
  isolate --check-config >/dev/null || die "isolate rejected $CONF"
}

smoke_test() {
  box=$((NUM_BOXES - 1))
  as_user isolate --cg --box-id="$box" --init >/dev/null || die "isolate --init failed (output above)"
  if ! out=$(as_user isolate --cg --box-id="$box" --run -- /bin/echo ok 2>&1); then
    as_user isolate --cg --box-id="$box" --cleanup >/dev/null 2>&1 || true
    die "isolate --run failed: $out"
  fi
  as_user isolate --cg --box-id="$box" --cleanup >/dev/null
  cpus=$(cat "$CG/cpuset.cpus.effective" 2>/dev/null || echo '?')
  log "isolate $(isolate --version | head -n1 | awk '{print $NF}') ready: cg_root=$ISOLATE_CG, $NUM_BOXES boxes, cpu pinning=$PINNING over cpus $cpus, syscall_flags=$SYSCALL_FLAGS"
}

if [ "$(id -u)" != 0 ]; then
  # Started with an explicit non-root user: nothing to prepare (and nothing we could).
  [ "$MODE" != isolate ] || log "not root: skipping cgroup/isolate setup; isolate will not work"
  exec "$@"
fi

case "$MODE" in
  isolate)
    setup_cgroups
    write_config
    smoke_test
    ;;
  local)
    log "SANDBOX_MODE=local: user code runs UNSANDBOXED (dev/smoke only)"
    ;;
  *) die "unknown SANDBOX_MODE '$MODE' (isolate | local)" ;;
esac

exec setpriv --reuid="$RUN_AS" --regid="$RUN_AS" --init-groups -- "$@"
