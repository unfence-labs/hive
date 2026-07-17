#!/usr/bin/env bash
# Tier-1 provision harness: run provision.sh inside a systemd container and
# assert install, idempotency, and crash-resume. See plan 7.1 / 7.2.
#
# Usage: provision-docker.sh [install|chaos]   (default: install)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROV="$ROOT/scripts/provision"
IMAGE="hive-provision-test"
VERSION="0.0.0-test"
MODE="${1:-install}"
CID=""

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*" >&2; }
cleanup() { [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

build_artifacts() {
  log "Build provision.sh"
  bash "$PROV/build.sh" "$VERSION" >/dev/null
  log "Build fake release tarball"
  local rel="$PROV/dist/fake-release.tar.gz"
  # The real backend tarball ships dist/index.js; mirror that layout.
  local staging; staging="$(mktemp -d)"
  mkdir -p "$staging/dist"
  cp "$ROOT/test/provision/fake-release/index.js" "$staging/dist/index.js"
  tar -czf "$rel" -C "$staging" dist
  rm -rf "$staging"
  echo "$rel"
}

build_image() {
  log "Build systemd test image"
  docker build -q -f "$ROOT/test/images/ubuntu-systemd.Dockerfile" -t "$IMAGE" "$ROOT" >/dev/null
}

start_container() {
  CID="$(docker run -d --rm --privileged --cgroupns=host \
    -v /sys/fs/cgroup:/sys/fs/cgroup "$IMAGE")"
  # Wait for systemd to be ready.
  for _ in $(seq 1 30); do
    docker exec "$CID" systemctl is-system-running --wait >/dev/null 2>&1 && break
    sleep 1
  done
}

# Run provision.sh in the container. Extra args after the release path.
run_provision() {
  local rel="$1"; shift
  docker cp "$PROV/dist/provision.sh" "$CID:/root/provision.sh"
  docker cp "$rel" "$CID:/root/release.tar.gz"
  docker exec ${DIE_AFTER:+-e HIVE_TEST_DIE_AFTER=$DIE_AFTER} "$CID" \
    bash /root/provision.sh \
      --skip-tailscale --skip-ufw --skip-node \
      --host 127.0.0.1 --port 3000 \
      --release-file /root/release.tar.gz "$@"
}

assert_healthy() {
  if ! docker exec "$CID" curl -fsS http://127.0.0.1:3000/health | grep -q '"status":"ok"'; then
    echo "FAIL: health endpoint not ok — service journal:"
    docker exec "$CID" systemctl status hive --no-pager -l 2>&1 | tail -20 || true
    docker exec "$CID" journalctl -u hive --no-pager -n 30 2>&1 || true
    return 1
  fi
  docker exec "$CID" systemctl is-active --quiet hive \
    || { echo "FAIL: hive.service not active"; return 1; }
  echo "OK: hive healthy and active"
}

assert_all_skip() {
  # Second run must skip every step (idempotency).
  local out; out="$(run_provision "$1" 2>&1)"
  local skipped started
  skipped="$(grep -c '"status":"skip"' <<<"$out" || true)"
  started="$(grep -c '"status":"start"' <<<"$out" || true)"
  echo "  re-run: $skipped skipped, $started started"
  [ "$started" = 0 ] || { echo "FAIL: idempotent re-run executed $started steps"; echo "$out"; return 1; }
  echo "OK: idempotent re-run skipped everything"
}

mode_install() {
  local rel; rel="$(build_artifacts)"
  build_image; start_container
  log "Run 1: full install"
  run_provision "$rel" | tail -5
  assert_healthy
  log "Run 2: idempotency"
  assert_all_skip "$rel"
  log "PASS (install + idempotency)"
}

mode_chaos() {
  local rel; rel="$(build_artifacts)"
  build_image
  # Representative kill points (fast path): after the release swap, after units.
  for kp in install_release write_units enable_service; do
    log "Chaos: die after '$kp', then resume"
    start_container
    set +e
    DIE_AFTER="$kp" run_provision "$rel" >/tmp/prov-die.log 2>&1
    local rc=$?
    set -e
    [ "$rc" = 137 ] || { echo "FAIL: expected exit 137, got $rc"; cat /tmp/prov-die.log; exit 1; }
    grep -q "\"step\":\"$kp\",\"status\":\"ok\"" /tmp/prov-die.log \
      || { echo "FAIL: $kp did not complete before the kill"; exit 1; }
    echo "  killed after $kp (exit 137)"
    DIE_AFTER="" run_provision "$rel" >/tmp/prov-resume.log 2>&1
    grep -q '"event":"run_end","status":"ok"' /tmp/prov-resume.log \
      || { echo "FAIL: resume did not finish ok"; cat /tmp/prov-resume.log; exit 1; }
    assert_healthy
    docker rm -f "$CID" >/dev/null 2>&1; CID=""
    echo "OK: resumed to healthy after '$kp' crash"
  done
  log "PASS (chaos/resume)"
}

case "$MODE" in
  install) mode_install ;;
  chaos)   mode_chaos ;;
  *) echo "usage: $0 [install|chaos]"; exit 2 ;;
esac
