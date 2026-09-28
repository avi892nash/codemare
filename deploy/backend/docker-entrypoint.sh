#!/bin/sh
# Entrypoint of the compile-service container (backend/Dockerfile).
#
# Starts as root, prepares what isolate needs, then drops to the unprivileged
# `codemare` user and execs the server:
#
#   1. cgroup v2 delegation. The container has a private cgroup namespace, so
#      /sys/fs/cgroup is "its" root. cgroup v2 forbids a cgroup that has
#      processes from delegating controllers to children, so every process is
#      moved into /sys/fs/cgroup/init first; then memory/pids (and cpuset,
#      unless ISOLATE_CPU_PINNING=off) are enabled for children and
#      /sys/fs/cgroup/isolate is created as isolate's cg_root (it creates
#      box-<id> under it per run).
#   2. /usr/local/etc/isolate: box root, uid/gid range, cg_root, and
#      syscall_flags = 65535 — every syscall restriction on. The compile
#      service passes --syscalls on every run anyway (only its Go compile
#      boxes may take file locks); the config default is what a hand-run
#      isolate gets.
#      CPU pinning is the compile service's own plan (one CPU per run box,
#      round-robin, one CPU kept for the API on 4+ CPUs — see
#      backend/src/services/sandbox/cpuPinning.ts). The service applies it
#      with taskset, which a program can undo with sched_setaffinity(2);
#      only a cgroup cpuset is binding, and only isolate (from this root-owned
#      config) may set a box's cpuset. So the plan is printed by the
#      service's code (cpuPinningCli.js, run as the service user, with the
#      same CPUs the server will have) and written here verbatim as
#      box<N>.cpus lines. The server's startup log reports whether pinning
#      is enforced.
#   3. A tmpfs on the box root (/var/local/lib/isolate), which holds every
#      box's /box and /tmp. tmpfs pages are charged to the memory cgroup of
#      the process that writes them and cannot be written back, so all a
#      program writes — stdout and every file — counts against its box's
#      memory limit (--cg-mem): a box cannot fill the disk with many files
#      that are each under the per-file cap (--fsize).
#   4. A smoke test (init, run, cleanup of one box as the service user), so a
#      host that cannot sandbox fails here, loudly, not at the first submission.
#
# SANDBOX_MODE=local skips all of this (unsandboxed dev adapter; the server
# itself refuses it when NODE_ENV=production).
set -eu

CG=/sys/fs/cgroup
ISOLATE_CG="$CG/isolate"
BOX_ROOT=/var/local/lib/isolate
CONF=/usr/local/etc/isolate
RUN_AS="${RUN_AS:-codemare}"
APP_DIR="${CODEMARE_BACKEND_DIR:-/app/backend}"
PINNING="${ISOLATE_CPU_PINNING:-round-robin}"
NUM_BOXES="${ISOLATE_NUM_BOXES:-1000}"
MODE=$(printf '%s' "${SANDBOX_MODE:-isolate}" | tr '[:upper:]' '[:lower:]')

log() { echo "codemare-backend: $*" >&2; }
die() { log "FATAL: $*"; exit 1; }
as_user() { setpriv --reuid="$RUN_AS" --regid="$RUN_AS" --init-groups -- "$@"; }

case "$PINNING" in
  round-robin | off) ;;
  *) die "ISOLATE_CPU_PINNING must be round-robin or off, got '$PINNING'" ;;
esac
case "$NUM_BOXES" in '' | *[!0-9]*) die "ISOLATE_NUM_BOXES must be a number, got '$NUM_BOXES'" ;; esac

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

mount_box_root() {
  # Root-owned and not writable by others, as isolate requires of box_root;
  # exec stays allowed (compiled programs run from /box).
  mkdir -p "$BOX_ROOT"
  if [ "$(stat -fc %T "$BOX_ROOT")" != tmpfs ]; then
    mount -t tmpfs -o mode=0755,nosuid,nodev codemare-boxes "$BOX_ROOT" ||
      die "cannot mount a tmpfs on $BOX_ROOT (is the container privileged?)"
  fi
}

write_config() {
  # The service's CPU plan, as isolate per-box cpusets (comments when off).
  cpusets=$(as_user node "$APP_DIR/dist/services/sandbox/cpuPinningCli.js" "$NUM_BOXES") ||
    die "could not compute the CPU plan (output above)"
  {
    echo "# Written by codemare-backend-entrypoint on every start; edits are lost."
    echo "box_root = $BOX_ROOT"
    echo "lock_root = /run/isolate/locks"
    echo "cg_root = $ISOLATE_CG"
    echo "first_uid = 60000"
    echo "first_gid = 60000"
    echo "num_boxes = $NUM_BOXES"
    echo "syscall_flags = 65535"
    printf '%s\n' "$cpusets"
  } >"$CONF"
  chmod 0644 "$CONF"
  isolate --check-config >/dev/null || die "isolate rejected $CONF"
  plan=$(printf '%s\n' "$cpusets" | sed -n 's/^# CPU plan[^:]*: //p')
}

smoke_test() {
  box=$((NUM_BOXES - 1))
  as_user isolate --cg --box-id="$box" --init >/dev/null || die "isolate --init failed (output above)"
  if ! out=$(as_user isolate --cg --box-id="$box" --run -- /bin/echo ok 2>&1); then
    as_user isolate --cg --box-id="$box" --cleanup >/dev/null 2>&1 || true
    die "isolate --run failed: $out"
  fi
  as_user isolate --cg --box-id="$box" --cleanup >/dev/null
  log "isolate $(isolate --version | head -n1 | awk '{print $NF}') ready: cg_root=$ISOLATE_CG, box_root=$BOX_ROOT (tmpfs), $NUM_BOXES boxes, syscall_flags=65535, cpu pinning=$PINNING${plan:+ ($plan)}"
}

if [ "$(id -u)" != 0 ]; then
  # Started with an explicit non-root user: nothing to prepare (and nothing we could).
  [ "$MODE" != isolate ] || log "not root: skipping cgroup/isolate setup; isolate will not work"
  exec "$@"
fi

plan=
case "$MODE" in
  isolate)
    setup_cgroups
    mount_box_root
    write_config
    smoke_test
    ;;
  local)
    log "SANDBOX_MODE=local: user code runs UNSANDBOXED (dev/smoke only)"
    ;;
  *) die "unknown SANDBOX_MODE '$MODE' (isolate | local)" ;;
esac

exec setpriv --reuid="$RUN_AS" --regid="$RUN_AS" --init-groups -- "$@"
