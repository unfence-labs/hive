#!/usr/bin/env bash
# Tier-1 provision harness: run provision.sh inside a systemd container and
# assert install, idempotency, and crash-resume.
#
# Usage: provision-docker.sh [install|chaos|rollback|download]   (default: install)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROV="$ROOT/scripts/provision"
IMAGE="hive-provision-test"
VERSION="0.0.0-test"
MODE="${1:-install}"
CID=""
TEST_SKIP_NODE="${TEST_SKIP_NODE:-1}"

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*" >&2; }
cleanup() { [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

build_artifacts() {
  local name="${1:-fake-release}" health="${2:-healthy}"
  local release_version="${3:-$VERSION}"
  local health_version="${4:-$release_version}"
  log "Build provision.sh"
  bash "$PROV/build.sh" "$VERSION" >/dev/null
  log "Build fake release tarball"
  local rel="$PROV/dist/$name.tar.gz"
  # Mirror the real tarball layout: dist/index.js plus loadable node_modules
  # stubs for the natives install_release verifies (node-pty, sharp).
  local staging; staging="$(mktemp -d)"
  mkdir -p "$staging/dist"
  if [ "$health" = unhealthy ]; then
    sed 's/res.writeHead(200/res.writeHead(503/' \
      "$ROOT/test/provision/fake-release/index.js" >"$staging/dist/index.js"
  else
    cp "$ROOT/test/provision/fake-release/index.js" "$staging/dist/index.js"
  fi
  printf '{"name":"hive-test-release","version":"%s","private":true,"type":"commonjs"}\n' \
    "$release_version" >"$staging/package.json"
  printf '%s\n' "$health_version" >"$staging/health-version"
  local m
  for m in node-pty sharp; do
    mkdir -p "$staging/node_modules/$m"
    printf '{"name":"%s","version":"0.0.0-test","main":"index.js"}\n' "$m" \
      >"$staging/node_modules/$m/package.json"
    cat >"$staging/node_modules/$m/index.js" <<'EOF'
if (typeof process.getuid === "function" && process.getuid() === 0) {
  throw new Error("native release validation must not run as root");
}
module.exports = {};
EOF
  done
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "$rel" -C "$staging" \
    dist node_modules package.json health-version
  rm -rf "$staging"
  echo "$rel"
}

build_image() {
  log "Build systemd test image"
  # Context is the Dockerfile's own dir (no COPY): the repo root would tar
  # gigabytes of node_modules/.git into the docker daemon for nothing.
  docker build -q -f "$ROOT/test/images/ubuntu-systemd.Dockerfile" -t "$IMAGE" "$ROOT/test/images" >/dev/null
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
  run_provision_script "$PROV/dist/provision.sh" "$rel" "$@"
}

# Like run_provision but with an explicit provision.sh path (e.g. a second build
# at a bumped SCRIPT_VERSION, to exercise the re-provision/update path).
run_provision_script() {
  local prov="$1" rel="$2"; shift 2
  local node_flag=""
  [ "$TEST_SKIP_NODE" = 1 ] && node_flag="--test-skip-node"
  docker cp "$prov" "$CID:/root/provision.sh"
  docker cp "$rel" "$CID:/root/release.tar.gz"
  # shellcheck disable=SC2086 # node_flag is either empty or one fixed option
  docker exec \
    -e "HIVE_TEST_DIE_AFTER=${DIE_AFTER:-}" \
    -e "HIVE_TEST_DIE_DURING=${DIE_DURING:-}" \
    -e "HIVE_HEALTH_ATTEMPTS=${HEALTH_ATTEMPTS:-}" \
    "$CID" \
    bash /root/provision.sh \
      --local-dev --test-skip-ufw $node_flag \
      --host 127.0.0.1 --port 3000 \
      --dev-release-file /root/release.tar.gz "$@"
}

assert_healthy() {
  local expected
  expected="$(docker exec "$CID" sh -c 'cat "$(readlink -f /opt/hive/current)/.hive-version"')"
  if ! docker exec "$CID" sh -c \
    "curl -fsS http://127.0.0.1:3000/health | jq -e --arg version '$expected' '.status == \"ok\" and .version == \$version' >/dev/null"; then
    echo "FAIL: health endpoint not ok — service journal:"
    docker exec "$CID" systemctl status hive --no-pager -l 2>&1 | tail -20 || true
    docker exec "$CID" journalctl -u hive --no-pager -n 30 2>&1 || true
    return 1
  fi
  docker exec "$CID" systemctl is-active --quiet hive \
    || { echo "FAIL: hive.service not active"; return 1; }
  echo "OK: hive healthy and active"
}

assert_installation() {
  docker exec "$CID" sh -c 'command -v gh >/dev/null' \
    || { echo "FAIL: GitHub CLI was not installed during provisioning"; return 1; }
  [ "$(docker exec "$CID" node -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ] \
    || { echo "FAIL: Node.js 22 or newer was not installed"; return 1; }
  docker exec "$CID" sh -c \
    'grep -Rqs "deb.nodesource.com" /etc/apt/sources.list /etc/apt/sources.list.d' \
    || { echo "FAIL: NodeSource repository was not bootstrapped"; return 1; }
  [ "$(docker exec "$CID" systemctl show hive -p User --value)" = hive ]
  [ "$(docker exec "$CID" systemctl show hive -p NoNewPrivileges --value)" = yes ]
  [ "$(docker exec "$CID" systemctl show hive -p ProtectSystem --value)" = strict ]
  [ "$(docker exec "$CID" systemctl show hive -p PrivateTmp --value)" = yes ]
  docker exec "$CID" test ! -e /usr/lib/hive/helpers
  docker exec "$CID" test ! -e /etc/sudoers.d/hive
  echo "OK: GitHub CLI installed and service hardening active"
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
  log "Remove prewarmed Node.js and its repository so provisioning must bootstrap both"
  docker exec "$CID" apt-get purge -y nodejs >/dev/null
  docker exec "$CID" sh -c '
    rm -f /etc/apt/sources.list.d/nodesource* &&
    find /etc/apt/keyrings /usr/share/keyrings -maxdepth 1 -iname "*nodesource*" -delete 2>/dev/null || true
    apt-get update -qq
    ! command -v node >/dev/null
    ! grep -Rqs "deb.nodesource.com" /etc/apt/sources.list /etc/apt/sources.list.d
  '
  TEST_SKIP_NODE=0
  log "Run 1: full install"
  run_provision "$rel" | tail -5
  assert_healthy
  assert_installation
  log "Run 2: remove legacy helper privileges"
  docker exec "$CID" mkdir -p /usr/lib/hive/helpers
  docker exec "$CID" touch /usr/lib/hive/helpers/legacy /etc/sudoers.d/hive
  local cleanup_out
  cleanup_out="$(run_provision "$rel" 2>&1)"
  grep -q '"step":"remove_legacy_helpers","status":"start"' <<<"$cleanup_out"
  docker exec "$CID" test ! -e /usr/lib/hive/helpers
  docker exec "$CID" test ! -e /etc/sudoers.d/hive
  log "Run 3: idempotency"
  assert_all_skip "$rel"
  log "Run 4: stopped-service recovery"
  docker exec "$CID" systemctl stop hive
  run_provision "$rel" >/tmp/prov-recover.log
  assert_healthy
  log "PASS (install + idempotency + service recovery)"
}

mode_chaos() {
  local rel; rel="$(build_artifacts)"
  build_image

  log "Chaos: die inside the release activation window, then resume"
  start_container
  set +e
  DIE_DURING=release_after_swap run_provision "$rel" >/tmp/prov-swap-die.log 2>&1
  local rc=$?
  set -e
  [ "$rc" = 137 ] || { echo "FAIL: expected exit 137, got $rc"; cat /tmp/prov-swap-die.log; exit 1; }
  docker exec "$CID" test -s /var/lib/hive/pending-release
  docker exec "$CID" test -e /var/lib/hive/restart-required
  docker exec "$CID" test ! -e /var/lib/hive/activated-release
  DIE_DURING="" run_provision "$rel" >/tmp/prov-swap-resume.log 2>&1
  assert_healthy
  [ "$(docker exec "$CID" readlink -f /opt/hive/current)" = \
    "$(docker exec "$CID" cat /var/lib/hive/activated-release)" ]
  docker exec "$CID" test ! -e /var/lib/hive/pending-release
  docker rm -f "$CID" >/dev/null 2>&1; CID=""
  echo "OK: activation intent forced restart and health verification after swap crash"

  # Representative kill points (fast path): after the release swap, after units.
  for kp in install_release write_units enable_service; do
    log "Chaos: die after '$kp', then resume"
    start_container
    set +e
    DIE_AFTER="$kp" run_provision "$rel" >/tmp/prov-die.log 2>&1
    rc=$?
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

mode_rollback() {
  local rel; rel="$(build_artifacts stable healthy)"
  build_image; start_container
  log "Run 1: install the healthy release"
  run_provision "$rel" | tail -3
  assert_healthy
  local previous
  previous="$(docker exec "$CID" readlink -f /opt/hive/current)"

  log "Run 2: activate a release whose health response reports the wrong version"
  local broken prov2="$PROV/dist/provision-rollback.sh"
  broken="$(build_artifacts mismatched healthy 0.0.1-test 0.0.0-wrong)"
  bash "$PROV/build.sh" "0.0.1-test" >/dev/null
  cp "$PROV/dist/provision.sh" "$prov2"
  local out
  set +e
  HEALTH_ATTEMPTS=2
  out="$(run_provision_script "$prov2" "$broken" 2>&1)"
  local rc=$?
  HEALTH_ATTEMPTS=""
  set -e
  [ "$rc" != 0 ] || { echo "FAIL: unhealthy release unexpectedly succeeded"; return 1; }
  grep -q '"errorCode":"HEALTH_TIMEOUT"' <<<"$out" \
    || { echo "FAIL: rollback did not report HEALTH_TIMEOUT"; echo "$out"; return 1; }
  [ "$(docker exec "$CID" readlink -f /opt/hive/current)" = "$previous" ] \
    || { echo "FAIL: current symlink was not rolled back"; return 1; }
  assert_healthy
  log "PASS (unhealthy release rolled back)"
}

# Exercise the real download branch of install_release against an in-container
# HTTP origin: 404, unparsable checksum, checksum mismatch, then a good install.
run_provision_download() {
  docker cp "$PROV/dist/provision.sh" "$CID:/root/provision.sh"
  docker exec -e HIVE_TEST_RELEASE_BASE_URL="http://127.0.0.1:8000" "$CID" \
    bash /root/provision.sh --local-dev --test-skip-ufw --test-skip-node \
      --host 127.0.0.1 --port 3000
}

expect_download_failure() {
  local expected_code="$1" out rc
  set +e
  out="$(run_provision_download 2>&1)"
  rc=$?
  set -e
  [ "$rc" != 0 ] || { echo "FAIL: provisioning unexpectedly succeeded"; echo "$out"; return 1; }
  grep -q "\"errorCode\":\"$expected_code\"" <<<"$out" \
    || { echo "FAIL: expected $expected_code"; echo "$out"; return 1; }
  echo "OK: died with $expected_code"
}

mode_download() {
  local rel; rel="$(build_artifacts)"
  build_image; start_container
  local tag asset
  case "$(docker exec "$CID" uname -m)" in
    aarch64) tag=arm64 ;;
    *) tag=x64 ;;
  esac
  asset="hive-backend-$VERSION-linux-$tag.tar.gz"

  log "Serve releases over HTTP inside the container"
  docker exec "$CID" mkdir -p /srv/release
  docker exec -i "$CID" sh -c 'cat > /srv/serve.js' <<'EOF'
const http = require("http"), fs = require("fs"), path = require("path");
http.createServer((req, res) => {
  fs.readFile(path.join("/srv/release", path.basename(req.url)), (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(data);
  });
}).listen(8000, "127.0.0.1");
EOF
  docker exec -d "$CID" node /srv/serve.js
  for _ in $(seq 1 20); do
    docker exec "$CID" curl -s -o /dev/null http://127.0.0.1:8000/ && break
    sleep 0.5
  done

  log "Case 1: missing release asset"
  expect_download_failure RELEASE_DOWNLOAD_FAILED

  log "Case 2: unparsable checksum file"
  docker cp "$rel" "$CID:/srv/release/$asset"
  docker exec "$CID" sh -c "printf 'not-a-checksum\n' > /srv/release/$asset.sha256"
  expect_download_failure CHECKSUM_MISMATCH

  log "Case 3: checksum mismatch (tampered download)"
  docker exec "$CID" sh -c "printf '%064d  $asset\n' 0 > /srv/release/$asset.sha256"
  expect_download_failure CHECKSUM_MISMATCH

  log "Case 4: valid checksum installs to healthy"
  docker exec "$CID" sh -c "cd /srv/release && sha256sum $asset > $asset.sha256"
  run_provision_download | tail -3
  assert_healthy
  log "PASS (download + checksum verification)"
}

# The EXISTING_INSTALL false positive: a run that died at install_release left
# /opt/hive but no state (a version bump wipes it); the re-run must resume, not
# reject the box as a foreign install.
mode_reprovision() {
  local rel; rel="$(build_artifacts)"
  build_image; start_container

  log "Run 1: die right after install_release (marker written, no secrets yet)"
  set +e
  DIE_AFTER=install_release run_provision "$rel" >/tmp/prov-reprov-die.log 2>&1
  local rc=$?
  set -e
  [ "$rc" = 137 ] || { echo "FAIL: expected exit 137, got $rc"; cat /tmp/prov-reprov-die.log; exit 1; }
  docker exec "$CID" test -d /opt/hive
  docker exec "$CID" test -e /etc/hive/.hive-install

  log "Run 2: version-bumped re-run must resume, not die EXISTING_INSTALL"
  local prov2="$PROV/dist/provision-v2.sh"
  bash "$PROV/build.sh" "9.9.9-test" >/dev/null
  cp "$PROV/dist/provision.sh" "$prov2"
  local rel2; rel2="$(build_artifacts release-v2 healthy 9.9.9-test)"
  local out
  set +e
  out="$(run_provision_script "$prov2" "$rel2" 2>&1)"
  rc=$?
  set -e
  ! grep -q '"errorCode":"EXISTING_INSTALL"' <<<"$out" \
    || { echo "FAIL: re-provision died EXISTING_INSTALL"; echo "$out"; exit 1; }
  [ "$rc" = 0 ] || { echo "FAIL: re-provision exited $rc"; echo "$out"; exit 1; }
  grep -q '"event":"run_end","status":"ok"' <<<"$out" \
    || { echo "FAIL: re-provision did not finish ok"; echo "$out"; exit 1; }
  assert_healthy
  log "PASS (interrupted install re-provisions across a version bump)"
}

case "$MODE" in
  install)     mode_install ;;
  chaos)       mode_chaos ;;
  rollback)    mode_rollback ;;
  download)    mode_download ;;
  reprovision) mode_reprovision ;;
  *) echo "usage: $0 [install|chaos|rollback|download|reprovision]"; exit 2 ;;
esac
