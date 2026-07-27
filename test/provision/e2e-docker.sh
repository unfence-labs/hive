#!/usr/bin/env bash
# End-to-end provisioning lane.
#
#   test/provision/e2e-docker.sh [install|guards|checksum|rollback|chaos]
#   (default: install)
#
# Takes a bare Ubuntu 24.04 container with systemd as PID 1 — no curl, no git,
# no GitHub CLI, and Ubuntu's own Node.js 18 already installed — and runs the
# generated provision.sh against a real backend release served over HTTP. Then
# it proves the backend is healthy, that it refuses a request with no token and
# accepts one with the right token, and that the operator's system runtime was
# left untouched.
#
# The backend tarball is built once by scripts/release/build-backend-tarball.sh
# inside a node:22 container. Set HIVE_E2E_TARBALL to reuse an existing one.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROV="$ROOT/scripts/provision"
MODE="${1:-install}"
VERSION="0.0.0-e2e"
IMAGE="hive-provision-e2e"
NETWORK="hive-provision-e2e"
RELEASE_HOST="hive-e2e-release"
PORT=9420
CID=""
RELEASE_CID=""
WORK=""

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() {
  [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1
  [ -n "$RELEASE_CID" ] && docker rm -f "$RELEASE_CID" >/dev/null 2>&1
  docker network rm "$NETWORK" >/dev/null 2>&1
  [ -n "$WORK" ] && rm -rf "$WORK"
  return 0
}
trap cleanup EXIT

case "$(uname -m)" in
  x86_64) ARCH_TAG=x64 ;;
  aarch64|arm64) ARCH_TAG=arm64 ;;
  *) die "unsupported test host architecture: $(uname -m)" ;;
esac

WORK="$(mktemp -d)"
RELEASE_DIR="$WORK/release"
mkdir -p "$RELEASE_DIR"
ASSET="hive-backend-$VERSION-linux-$ARCH_TAG.tar.gz"

# --- Artifacts -------------------------------------------------------------

build_release() {
  if [ -n "${HIVE_E2E_TARBALL:-}" ] && [ -f "$HIVE_E2E_TARBALL" ]; then
    log "Reusing $HIVE_E2E_TARBALL"
    cp "$HIVE_E2E_TARBALL" "$RELEASE_DIR/$ASSET"
  else
    log "Build the real backend release tarball (node:22 container)"
    local src="$WORK/src"
    mkdir -p "$src"
    # Tracked files from the working tree, so local edits are what gets built.
    # A plain copy would drag node_modules and other ignored files into a build
    # that is supposed to resolve everything from the lockfile.
    ( cd "$ROOT" && git ls-files -z | tar -cf - --null -T - ) | tar -x -C "$src"
    docker run --rm -v "$src:/src" -v "$RELEASE_DIR:/out" -w /src \
      -e "OUT_DIR=/out" node:22 \
      bash scripts/release/build-backend-tarball.sh "$VERSION" "$ARCH_TAG" \
      || die "the backend release build failed"
  fi
  [ -f "$RELEASE_DIR/$ASSET" ] || die "no release tarball at $RELEASE_DIR/$ASSET"
  ( cd "$RELEASE_DIR" && sha256sum "$ASSET" >"$ASSET.sha256" )
  log "Release: $(cat "$RELEASE_DIR/$ASSET.sha256")"
}

build_provision() {
  log "Build provision.sh $VERSION"
  bash "$PROV/build.sh" "$VERSION" >/dev/null
}

# --- Containers ------------------------------------------------------------

build_image() {
  docker build -q -f "$ROOT/test/images/ubuntu-systemd.Dockerfile" -t "$IMAGE" \
    "$ROOT/test/images" >/dev/null
}

start_stack() {
  log "Start the release origin and a bare systemd server"
  build_image
  docker network create "$NETWORK" >/dev/null
  RELEASE_CID="$(docker run -d --network "$NETWORK" --network-alias "$RELEASE_HOST" \
    -v "$RELEASE_DIR:/usr/share/nginx/html:ro" nginx:alpine)"
  CID="$(docker run -d --network "$NETWORK" --privileged --cgroupns=host \
    -v /sys/fs/cgroup:/sys/fs/cgroup "$IMAGE")"
  for _ in $(seq 1 60); do
    docker exec "$CID" test -d /run/systemd/system >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "systemd never came up in the test container"
}

in_server() { docker exec "$CID" "$@"; }
sh_server() { docker exec "$CID" sh -c "$1"; }

# Run the generated provision.sh over stdin, exactly as `curl | bash` would.
# shellcheck disable=SC2120  # most callers deliberately pass no options
run_provision() {
  docker exec -i \
    -e "HIVE_RELEASE_BASE_URL=http://$RELEASE_HOST" \
    -e "HIVE_TEST_DIE_AFTER=${DIE_AFTER:-}" \
    -e "HIVE_TEST_DIE_DURING=${DIE_DURING:-}" \
    -e "HIVE_HEALTH_ATTEMPTS=${HEALTH_ATTEMPTS:-}" \
    "$CID" bash -s -- "$@" <"$PROV/dist/provision.sh"
}

# --- Assertions ------------------------------------------------------------

token_from_stream() {
  grep -o '"accessToken":"[0-9a-f]\{64\}"' "$1" | head -1 | cut -d'"' -f4
}

assert_run_ok() {
  grep -q '"event":"run_end","status":"ok"' "$1" \
    || { tail -30 "$1" >&2; die "the run did not finish ok"; }
}

# Every acceptance criterion that can be observed from outside the script.
assert_provisioned() {
  local stream="$1" token digest expected

  log "The system Node.js is untouched and no vendor repository was added"
  [ "$(sh_server '/usr/bin/node -p "process.versions.node.split(\".\")[0]"')" = 18 ] \
    || die "the system Node.js was replaced"
  sh_server 'grep -Rqs nodesource /etc/apt/sources.list /etc/apt/sources.list.d' \
    && die "a NodeSource repository was added to the system"
  sh_server 'test -e /etc/apt/keyrings/githubcli-archive-keyring.gpg' \
    && die "a GitHub CLI apt repository was added to the system"
  echo "OK: /usr/bin/node is still $(sh_server '/usr/bin/node -v')"

  log "Hive's own runtime is pinned and lives inside the install directory"
  local pinned; pinned="$(sed -n 's/^NODE_VERSION="\(.*\)"/\1/p' "$PROV/steps.sh")"
  [ "$(sh_server '/opt/hive/runtime/current/bin/node -v')" = "v$pinned" ] \
    || die "the private runtime is not v$pinned"
  echo "OK: /opt/hive/runtime/current/bin/node is v$pinned"

  log "The agent CLIs the backend requires are installed as the service account"
  sh_server 'runuser -u hive -- env PATH=/home/hive/.local/bin:/opt/hive/runtime/current/bin:/usr/bin:/bin claude --version' >/dev/null \
    || die "claude is not runnable as the hive service account"
  sh_server 'runuser -u hive -- env PATH=/home/hive/.local/bin:/opt/hive/runtime/current/bin:/usr/bin:/bin gh --version' >/dev/null \
    || die "gh is not runnable as the hive service account"
  sh_server 'test ! -e /usr/local/bin/claude && test ! -e /usr/bin/gh' \
    || die "an agent CLI was installed system-wide"
  echo "OK: claude, codex and gh live under /home/hive/.local"

  log "The release was activated by symlink and the service is hardened"
  sh_server 'test -L /opt/hive/current' || die "/opt/hive/current is not a symlink"
  [ "$(in_server systemctl show hive -p User --value)" = hive ] || die "the service does not run as hive"
  [ "$(in_server systemctl show hive -p NoNewPrivileges --value)" = yes ] || die "NoNewPrivileges is not set"
  [ "$(in_server systemctl show hive -p ProtectSystem --value)" = strict ] || die "ProtectSystem is not strict"
  [ "$(in_server systemctl show hive -p PrivateTmp --value)" = yes ] || die "PrivateTmp is not set"
  in_server systemctl is-active --quiet hive || die "hive.service is not active"
  echo "OK: hive.service runs as an unprivileged, restricted unit"

  log "The token digest is on disk, root-only, and the plaintext is not"
  token="$(token_from_stream "$stream")"
  [ -n "$token" ] || die "no access token was reported on the progress stream"
  [ "$(grep -c '"accessToken":"[0-9a-f]\{64\}"' "$stream")" = 1 ] \
    || die "the access token was reported more than once"
  [ "$(sh_server 'stat -c "%U:%G %a" /etc/hive/hive.env')" = "root:root 600" ] \
    || die "hive.env is not root-owned mode 600"
  digest="$(sh_server 'sed -n "s/^HIVE_AUTH_TOKEN_SHA256=//p" /etc/hive/hive.env')"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die "hive.env carries no valid token digest: '$digest'"
  expected="$(printf '%s' "$token" | sha256sum | cut -d' ' -f1)"
  [ "$digest" = "$expected" ] || die "the stored digest is not the SHA-256 of the reported token"
  sh_server "grep -q '$token' /var/lib/hive/provision.log.ndjson" \
    && die "the plaintext token reached the provision log file"
  sh_server 'grep -q "\[redacted\]" /var/lib/hive/provision.log.ndjson' \
    || die "the provision log has no redacted token record"
  echo "OK: only the digest is on disk; the plaintext appeared once, on the stream only"

  log "The backend is healthy and enforces the token"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/health")" = 200 ] \
    || die "/health is not answering 200"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/api/projects")" = 401 ] \
    || die "an unauthenticated API request was not rejected"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: wrong' http://127.0.0.1:$PORT/api/projects")" = 401 ] \
    || die "a request with the wrong token was not rejected"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: $token' http://127.0.0.1:$PORT/api/projects")" = 200 ] \
    || die "a request with the right token was not accepted"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'authorization: Bearer $token' http://127.0.0.1:$PORT/api/projects")" = 200 ] \
    || die "a bearer request with the right token was not accepted"
  echo "OK: no token -> 401, wrong token -> 401, right token -> 200"
}

# --- Modes -----------------------------------------------------------------

mode_install() {
  build_release; build_provision; start_stack

  # Arguments go through `bash -s --`, which is how an operator passes options
  # to a piped script.
  log "Run 1: full install on a bare server"
  run_provision --port "$PORT" >"$WORK/run1.ndjson" \
    || { tail -30 "$WORK/run1.ndjson" >&2; die "provisioning failed"; }
  assert_run_ok "$WORK/run1.ndjson"
  assert_provisioned "$WORK/run1.ndjson"
  local token1; token1="$(token_from_stream "$WORK/run1.ndjson")"

  log "Run 2: re-run resumes instead of repeating the expensive work"
  run_provision >"$WORK/run2.ndjson" || { tail -30 "$WORK/run2.ndjson" >&2; die "the re-run failed"; }
  assert_run_ok "$WORK/run2.ndjson"
  local step
  for step in probe_os apt_baseline create_user install_node install_agent_clis install_release; do
    grep -q "\"step\":\"$step\",\"status\":\"skip\"" "$WORK/run2.ndjson" \
      || die "step '$step' repeated its work on a re-run"
  done
  echo "OK: every download and install step was skipped"

  local token2; token2="$(token_from_stream "$WORK/run2.ndjson")"
  [ -n "$token2" ] && [ "$token1" != "$token2" ] || die "the access token was not rotated on the re-run"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: $token1' http://127.0.0.1:$PORT/api/projects")" = 401 ] \
    || die "the previous run's token still works"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: $token2' http://127.0.0.1:$PORT/api/projects")" = 200 ] \
    || die "the rotated token does not work"
  echo "OK: the token rotated and the old one stopped working"

  log "Run 3: recover a stopped service"
  in_server systemctl stop hive
  run_provision >"$WORK/run3.ndjson" || { tail -30 "$WORK/run3.ndjson" >&2; die "recovery run failed"; }
  assert_run_ok "$WORK/run3.ndjson"
  in_server systemctl is-active --quiet hive || die "the service was not restarted"
  echo "OK: a stopped service is restarted and re-verified"

  log "PASS (install, token enforcement, resume, recovery)"
}

# Every failing case here dies inside install_release, so the same server can
# carry all of them: the run resumes past the steps that already succeeded and
# retries only the download. That is the resume guarantee under a typed failure.
expect_release_failure() {
  local label="$1" expected_code="$2" out rc
  set +e
  out="$(run_provision 2>&1)"; rc=$?
  set -e
  [ "$rc" != 0 ] || die "$label: provisioning unexpectedly succeeded"
  grep -q "\"errorCode\":\"$expected_code\"" <<<"$out" \
    || { tail -20 <<<"$out" >&2; die "$label: expected $expected_code"; }
  sh_server 'test ! -e /opt/hive/current' \
    || die "$label: a release was activated despite the failure"
  echo "OK: $label died with $expected_code and activated nothing"
}

mode_checksum() {
  build_release; build_provision; start_stack

  log "Case 1: the release asset is not published"
  mv "$RELEASE_DIR/$ASSET" "$WORK/held.tar.gz"
  mv "$RELEASE_DIR/$ASSET.sha256" "$WORK/held.sha256"
  expect_release_failure "a missing release" RELEASE_DOWNLOAD_FAILED

  log "Case 2: the published checksum is unparsable"
  cp "$WORK/held.tar.gz" "$RELEASE_DIR/$ASSET"
  printf 'not-a-checksum\n' >"$RELEASE_DIR/$ASSET.sha256"
  expect_release_failure "an unparsable checksum" CHECKSUM_MISMATCH

  log "Case 3: the download does not match its published checksum"
  printf '%064d  %s\n' 0 "$ASSET" >"$RELEASE_DIR/$ASSET.sha256"
  expect_release_failure "a tampered download" CHECKSUM_MISMATCH

  log "Case 4: the real checksum installs to a healthy, protected backend"
  cp "$WORK/held.sha256" "$RELEASE_DIR/$ASSET.sha256"
  run_provision >"$WORK/good.ndjson" || { tail -30 "$WORK/good.ndjson" >&2; die "provisioning failed"; }
  assert_run_ok "$WORK/good.ndjson"
  assert_provisioned "$WORK/good.ndjson"
  log "PASS (the checksum is verified before anything is extracted)"
}

mode_chaos() {
  build_release; build_provision

  local kp out rc
  for kp in install_node install_agent_clis install_release write_units; do
    log "Chaos: die after '$kp', then resume"
    start_stack
    set +e
    # shellcheck disable=SC2119
    DIE_AFTER="$kp" run_provision >"$WORK/die.ndjson" 2>&1; rc=$?
    set -e
    [ "$rc" = 137 ] || { tail -20 "$WORK/die.ndjson" >&2; die "expected exit 137 after $kp, got $rc"; }
    grep -q "\"step\":\"$kp\",\"status\":\"ok\"" "$WORK/die.ndjson" \
      || die "$kp did not complete before the kill"
    DIE_AFTER="" run_provision >"$WORK/resume.ndjson" 2>&1 \
      || { tail -30 "$WORK/resume.ndjson" >&2; die "the resume after $kp failed"; }
    assert_run_ok "$WORK/resume.ndjson"
    grep -q "\"step\":\"$kp\",\"status\":\"skip\"" "$WORK/resume.ndjson" \
      || die "$kp repeated its work on the resume"
    in_server systemctl is-active --quiet hive || die "hive.service is not active after the resume"
    echo "OK: resumed to a healthy backend after a crash at '$kp'"
    docker rm -f "$CID" >/dev/null; CID=""
    docker rm -f "$RELEASE_CID" >/dev/null; RELEASE_CID=""
    docker network rm "$NETWORK" >/dev/null
  done

  log "Chaos: die inside the release activation window"
  start_stack
  set +e
  DIE_DURING=release_after_swap run_provision >"$WORK/swap.ndjson" 2>&1; rc=$?
  set -e
  [ "$rc" = 137 ] || { tail -20 "$WORK/swap.ndjson" >&2; die "expected exit 137, got $rc"; }
  sh_server 'test -s /var/lib/hive/pending-release' || die "no activation intent was recorded"
  sh_server 'test -e /var/lib/hive/restart-required' || die "no restart intent was recorded"
  sh_server 'test ! -e /var/lib/hive/activated-release' || die "the release was marked activated"
  DIE_DURING="" run_provision >"$WORK/swap-resume.ndjson" 2>&1 \
    || { tail -30 "$WORK/swap-resume.ndjson" >&2; die "the resume after the swap crash failed"; }
  assert_run_ok "$WORK/swap-resume.ndjson"
  out="$(sh_server 'readlink -f /opt/hive/current')"
  [ "$out" = "$(sh_server 'cat /var/lib/hive/activated-release')" ] \
    || die "the activated release does not match the current one"
  sh_server 'test ! -e /var/lib/hive/pending-release' || die "activation intent was not cleared"
  log "PASS (crash and resume)"
}

# The script must refuse a server it cannot support, and refuse to interleave
# with another run. These need no release, so they run against stock images.
expect_refusal() {
  local label="$1" code="$2"; shift 2
  local out rc
  set +e
  out="$(docker run --rm -i "$@" bash -s -- <"$PROV/dist/provision.sh" 2>&1)"; rc=$?
  set -e
  [ "$rc" != 0 ] || die "$label: the installer did not refuse"
  grep -q "\"errorCode\":\"$code\"" <<<"$out" \
    || { tail -5 <<<"$out" >&2; die "$label: expected $code"; }
  echo "OK: $label refused with $code — $(grep -o '"detail":"[^"]*"' <<<"$out" | tail -1)"
}

mode_guards() {
  build_provision; build_image

  log "A server without systemd (the same image, with systemd not running)"
  expect_refusal "no systemd" UNSUPPORTED_OS "$IMAGE"

  log "An unsupported distribution"
  expect_refusal "Debian 11" UNSUPPORTED_OS debian:11

  log "A non-root user"
  expect_refusal "non-root" NOT_ROOT --user 1000:1000 "$IMAGE"

  log "A second run while another holds the lock"
  docker network create "$NETWORK" >/dev/null
  CID="$(docker run -d --network "$NETWORK" --privileged --cgroupns=host \
    -v /sys/fs/cgroup:/sys/fs/cgroup "$IMAGE")"
  for _ in $(seq 1 60); do
    docker exec "$CID" test -d /run/systemd/system >/dev/null 2>&1 && break
    sleep 1
  done
  in_server mkdir -p /var/lib/hive
  docker exec -d "$CID" sh -c 'exec 9>/var/lib/hive/provision.lock; flock 9; sleep 60'
  sleep 2
  local out rc
  set +e
  out="$(run_provision 2>&1)"; rc=$?
  set -e
  [ "$rc" != 0 ] || die "a concurrent run was allowed to proceed"
  grep -q '"errorCode":"CONCURRENT_RUN"' <<<"$out" \
    || { tail -5 <<<"$out" >&2; die "expected CONCURRENT_RUN"; }
  echo "OK: a second run refused with CONCURRENT_RUN"
  log "PASS (unsupported servers and concurrent runs are refused)"
}

# Break the backend's entrypoint in a second release, publish it, and prove the
# failed health check puts the previous release back and restarts the service.
mode_rollback() {
  build_release; build_provision; start_stack

  log "Install the healthy release"
  run_provision >"$WORK/healthy.ndjson" || { tail -30 "$WORK/healthy.ndjson" >&2; die "install failed"; }
  assert_run_ok "$WORK/healthy.ndjson"
  local previous; previous="$(sh_server 'readlink -f /opt/hive/current')"

  log "Publish a release whose backend exits on start"
  local broken="$WORK/broken" next="0.0.1-e2e"
  local next_asset="hive-backend-$next-linux-$ARCH_TAG.tar.gz"
  mkdir -p "$broken"
  tar -xzf "$RELEASE_DIR/$ASSET" -C "$broken"
  printf 'process.exit(1);\n' >"$broken/dist/index.js"
  ( cd "$broken" && node -e '
      const fs = require("node:fs");
      const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
      p.version = process.argv[1];
      fs.writeFileSync("package.json", JSON.stringify(p, null, 2));
    ' "$next" )
  ( cd "$broken" && tar --no-xattrs -czf "$RELEASE_DIR/$next_asset" . )
  ( cd "$RELEASE_DIR" && sha256sum "$next_asset" >"$next_asset.sha256" )

  log "Provision the broken release: it must fail and roll back"
  bash "$PROV/build.sh" "$next" >/dev/null
  local out rc
  set +e
  out="$(HEALTH_ATTEMPTS=3 run_provision 2>&1)"; rc=$?
  set -e
  printf '%s\n' "$out" >"$WORK/rollback.ndjson"
  [ "$rc" != 0 ] || die "the unhealthy release was accepted"
  grep -q '"errorCode":"HEALTH_TIMEOUT"' <<<"$out" \
    || { tail -20 <<<"$out" >&2; die "expected HEALTH_TIMEOUT"; }
  [ "$(sh_server 'readlink -f /opt/hive/current')" = "$previous" ] \
    || die "the current symlink was not rolled back"
  in_server systemctl is-active --quiet hive || die "the previous release was not restarted"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/health")" = 200 ] \
    || die "the restored release is not healthy"
  # The failed run still rotated and reported a token, so the restored service
  # must answer to it: a client is never left without a working credential.
  local token; token="$(token_from_stream "$WORK/rollback.ndjson")"
  [ -n "$token" ] || die "the failed run reported no access token"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: $token' http://127.0.0.1:$PORT/api/projects")" = 200 ] \
    || die "the restored release does not accept the token the failed run reported"
  echo "OK: rolled back to $previous and the service is healthy again"
  log "PASS (an unhealthy release is rolled back)"
}

command -v docker >/dev/null 2>&1 || die "docker is required to run this lane"
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable"

case "$MODE" in
  install)  mode_install ;;
  guards)   mode_guards ;;
  checksum) mode_checksum ;;
  rollback) mode_rollback ;;
  chaos)    mode_chaos ;;
  *) echo "usage: $0 [install|guards|checksum|rollback|chaos]" >&2; exit 2 ;;
esac
