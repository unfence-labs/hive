#!/usr/bin/env bash
# End-to-end provisioning lane.
#
#   test/provision/e2e-docker.sh [install|guards|checksum|rollback|chaos|
#                                 neighbour|preflight|paths|uninstall]
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
#
# shellcheck disable=SC2016  # single-quoted bodies are expanded in the container, not here
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROV="$ROOT/scripts/provision"
MODE="${1:-install}"
VERSION="0.0.0-e2e"
IMAGE="hive-provision-e2e"
BUILDER_IMAGE="node:22"
NETWORK="hive-provision-e2e"
RELEASE_HOST="hive-e2e-release"
SERVER_HOST="hive-e2e-server"
PORT=9420
# An ed25519 public key with a valid blob, used to prove the authorized_keys
# append is idempotent. It is a test fixture and opens nothing: no private
# half exists, and it only ever reaches a throwaway container.
TEST_SSH_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHZ2hRZjZDZlZTBhMzYxN2E0MmM4YjE0NjUzMWEz hive-e2e"
CID=""
RELEASE_CID=""
WORK=""

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*" >&2; }
die() { printf '\033[1;31mFAIL: %s\033[0m\n' "$*" >&2; exit 1; }

cleanup() {
  [ -n "$CID" ] && docker rm -f "$CID" >/dev/null 2>&1
  [ -n "$RELEASE_CID" ] && docker rm -f "$RELEASE_CID" >/dev/null 2>&1
  docker network rm "$NETWORK" >/dev/null 2>&1
  # The build container installs into $WORK/src, and a rootful daemon leaves
  # those directories owned by root — this shell cannot unlink inside them, so
  # a plain rm would leak the tree. Deleting from inside a container works
  # whichever way the daemon runs.
  if [ -n "$WORK" ] && [ -d "$WORK/src" ]; then
    docker run --rm -v "$WORK:/work" "$BUILDER_IMAGE" rm -rf /work/src >/dev/null 2>&1
  fi
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
      -e "OUT_DIR=/out" "$BUILDER_IMAGE" \
      bash scripts/release/build-backend-tarball.sh "$VERSION" "$ARCH_TAG" \
      || die "the backend release build failed"
  fi
  [ -f "$RELEASE_DIR/$ASSET" ] || die "no release tarball at $RELEASE_DIR/$ASSET"
  # The published checksum: served beside the tarball, and what the script
  # verifies its download against before it extracts anything. It is recomputed
  # from the tarball actually about to be served, because neither source
  # supplies a usable one — the reuse path copies in a tarball with no checksum
  # beside it, and the build container leaves one this shell cannot overwrite
  # in place when the daemon runs as root.
  rm -f "$RELEASE_DIR/$ASSET.sha256"
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
  CID="$(docker run -d --network "$NETWORK" --network-alias "$SERVER_HOST" --privileged \
    --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup "$IMAGE")"
  for _ in $(seq 1 60); do
    docker exec "$CID" test -d /run/systemd/system >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "systemd never came up in the test container"
}

in_server() { docker exec "$CID" "$@"; }
sh_server() { docker exec "$CID" sh -c "$1"; }

# Reach the server the way a real client does: from another host on the
# network, through the kernel's filter chains. A localhost curl inside the
# container proves nothing about a firewall, because ufw always lets loopback
# through — the whole question is whether an outside peer still gets in.
from_peer() {
  # from_peer <host> <port> [path]
  docker exec "$RELEASE_CID" wget -q -T 5 -O - "http://$1:$2${3:-/}" 2>/dev/null
}
peer_can_reach() { from_peer "$@" >/dev/null 2>&1; }

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

run_preflight_unprivileged() {
  docker exec -i --user nobody "$CID" bash -s -- --preflight "$@" \
    <"$PROV/dist/provision.sh"
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

  log "Fresh install succeeds and writes both durable markers"
  run_provision --port "$PORT" --ssh-public-key "$TEST_SSH_KEY" >"$WORK/fresh.ndjson" \
    || { tail -30 "$WORK/fresh.ndjson" >&2; die "fresh provisioning failed"; }
  assert_run_ok "$WORK/fresh.ndjson"
  assert_provisioned "$WORK/fresh.ndjson"
  sh_server 'test "$(cat /etc/hive/.hive-install)" = "schema=1
port=9420
install_dir=/opt/hive
data_dir=/home/hive/.hive"' || die "the install identity manifest is wrong"
  sh_server 'test "$(cat /etc/hive/.hive-install-complete)" = "schema=1"' \
    || die "the completion marker is missing"
  [ "$(sh_server 'stat -c "%U:%G %a" /etc/hive/.hive-install')" = "root:root 644" ] \
    || die "the identity manifest is not root-owned mode 644"
  [ "$(sh_server 'stat -c "%U:%G %a" /etc/hive/.hive-install-complete')" = "root:root 644" ] \
    || die "the completion marker is not root-owned mode 644"
  sh_server 'runuser -u nobody -- cat /etc/hive/.hive-install /etc/hive/.hive-install-complete >/dev/null' \
    || die "an unprivileged preflight account cannot read the install state"
  echo "OK: fresh install completed with an exact, root-owned, preflight-readable identity"

  local rc
  log "A completed install rejects an exact re-run"
  set +e
  run_provision --port "$PORT" >"$WORK/completed-exact.ndjson" 2>&1; rc=$?
  set -e
  if [ "$rc" = 0 ] || ! grep -q '"errorCode":"ALREADY_INSTALLED"' "$WORK/completed-exact.ndjson"; then
    tail -20 "$WORK/completed-exact.ndjson" >&2
    die "completed exact re-run was not rejected"
  fi

  log "A completed install rejects changed options as an unsupported update"
  set +e
  run_provision --port "$((PORT + 1))" --install-dir /srv/hive-app --data-dir /mnt/hive-data \
    >"$WORK/completed-changed.ndjson" 2>&1; rc=$?
  set -e
  if [ "$rc" = 0 ] || ! grep -q '"errorCode":"ALREADY_INSTALLED"' "$WORK/completed-changed.ndjson"; then
    tail -20 "$WORK/completed-changed.ndjson" >&2
    die "completed changed re-run was not rejected"
  fi
  echo "OK: completed installs reject exact and changed re-runs"

  docker rm -f "$CID" >/dev/null; CID=""
  docker rm -f "$RELEASE_CID" >/dev/null; RELEASE_CID=""
  docker network rm "$NETWORK" >/dev/null
  start_stack

  log "Crash after authenticated health verification, before completion"
  set +e
  DIE_AFTER=verify_auth run_provision --port "$PORT" --ssh-public-key "$TEST_SSH_KEY" \
    >"$WORK/crash.ndjson" 2>&1; rc=$?
  set -e
  [ "$rc" = 137 ] || { tail -20 "$WORK/crash.ndjson" >&2; die "expected exit 137 before completion, got $rc"; }
  grep -q '"step":"verify_auth","status":"ok"' "$WORK/crash.ndjson" \
    || die "authenticated health was not proven before the crash"
  sh_server 'test ! -e /etc/hive/.hive-install-complete' \
    || die "the crashed install was marked complete"
  assert_provisioned "$WORK/crash.ndjson"
  local token1; token1="$(token_from_stream "$WORK/crash.ndjson")"

  log "Root preflight strictly proves the active Hive listener"
  run_provision --preflight --port "$PORT" >"$WORK/root-preflight.ndjson"
  grep -q '"check":"port","status":"ok".*"heldByHive":true' "$WORK/root-preflight.ndjson" \
    || die "root preflight did not prove the listener from hive.env"

  log "Unprivileged preflight recognizes the identity and defers port ownership"
  run_preflight_unprivileged --port "$PORT" >"$WORK/unprivileged-preflight.ndjson"
  grep -q '"check":"existing_install","status":"ok".*incomplete Hive install' \
    "$WORK/unprivileged-preflight.ndjson" \
    || die "unprivileged preflight could not read the incomplete identity"
  if sh_server 'test -S /run/dbus/system_bus_socket'; then
    grep -q '"check":"port","status":"warn".*"heldByHive":null' \
      "$WORK/unprivileged-preflight.ndjson" \
      || { grep '"check":"port"' "$WORK/unprivileged-preflight.ndjson" >&2
           die "unprivileged preflight did not defer root-only port ownership"; }
    grep -q '"event":"preflight","ok":true' "$WORK/unprivileged-preflight.ndjson" \
      || { grep '"status":"fail"' "$WORK/unprivileged-preflight.ndjson" >&2
           die "the exact incomplete install did not pass unprivileged preflight"; }
    echo "OK: preflight defers ownership without claiming it, then root proves it"
  else
    grep -q '"check":"port","status":"fail".*"errorCode":"PORT_IN_USE"' \
      "$WORK/unprivileged-preflight.ndjson" \
      || die "preflight did not fail closed without access to systemd state"
    echo "SKIP: the minimal fixture has no system bus for unprivileged systemctl"
  fi

  log "Changed port, install directory, and data directory each reject the incomplete install"
  set +e
  DIE_AFTER="" run_provision --port "$((PORT + 1))" >"$WORK/mismatch-port.ndjson" 2>&1; rc=$?
  set -e
  if [ "$rc" = 0 ] || ! grep -q '"errorCode":"INSTALL_IDENTITY_MISMATCH"' "$WORK/mismatch-port.ndjson"; then
    die "changed port did not fail with INSTALL_IDENTITY_MISMATCH"
  fi
  set +e
  run_provision --install-dir /srv/hive-app >"$WORK/mismatch-install.ndjson" 2>&1; rc=$?
  set -e
  if [ "$rc" = 0 ] || ! grep -q '"errorCode":"INSTALL_IDENTITY_MISMATCH"' "$WORK/mismatch-install.ndjson"; then
    die "changed install directory did not fail with INSTALL_IDENTITY_MISMATCH"
  fi
  set +e
  run_provision --data-dir /mnt/hive-data >"$WORK/mismatch-data.ndjson" 2>&1; rc=$?
  set -e
  if [ "$rc" = 0 ] || ! grep -q '"errorCode":"INSTALL_IDENTITY_MISMATCH"' "$WORK/mismatch-data.ndjson"; then
    die "changed data directory did not fail with INSTALL_IDENTITY_MISMATCH"
  fi

  log "The exact incomplete install resumes without repeating expensive work"
  sh_server 'printf "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHhhbmRhZGRlZGJ5dGhlb3BlcmF0b3JzaGVsbA operator-laptop\n" >>/home/hive/.ssh/authorized_keys'
  run_provision --port "$PORT" --ssh-public-key "${TEST_SSH_KEY% *} a-completely-different-comment" \
    >"$WORK/resume.ndjson" || { tail -30 "$WORK/resume.ndjson" >&2; die "the exact resume failed"; }
  assert_run_ok "$WORK/resume.ndjson"
  sh_server 'test -e /etc/hive/.hive-install-complete' || die "the resumed install was not completed"

  log "The resume neither duplicated our key nor removed the hand-added one"
  [ "$(sh_server "grep -c 'AAAAC3NzaC1lZDI1NTE5AAAAIHZ2hRZjZDZlZTBhMzYxN2E0MmM4YjE0NjUzMWEz' /home/hive/.ssh/authorized_keys")" = 1 ] \
    || { sh_server 'cat /home/hive/.ssh/authorized_keys' >&2; die "the key was appended twice"; }
  [ "$(sh_server "grep -c 'operator-laptop' /home/hive/.ssh/authorized_keys")" = 1 ] \
    || { sh_server 'cat /home/hive/.ssh/authorized_keys' >&2; die "a hand-added key was lost"; }
  [ "$(sh_server 'grep -c . /home/hive/.ssh/authorized_keys')" = 2 ] \
    || { sh_server 'cat /home/hive/.ssh/authorized_keys' >&2; die "authorized_keys has the wrong number of entries"; }
  grep -q '"step":"authorize_ssh_key","status":"skip"' "$WORK/resume.ndjson" \
    || die "the resume did not recognise the key as already authorized"
  echo "OK: two entries — ours once, the operator's untouched"
  local step
  for step in probe_os apt_baseline create_user install_node install_agent_clis install_release; do
    grep -q "\"step\":\"$step\",\"status\":\"skip\"" "$WORK/resume.ndjson" \
      || die "step '$step' repeated its work on a resume"
  done
  echo "OK: every download and install step was skipped"
  # The account is what the desktop app's editor and terminal sessions connect
  # as. A resumed run skips create_user, so the skip has to carry it too, or the
  # caller is left assuming a name that may not be the one on the server.
  grep -q '"step":"create_user","status":"skip".*"data":{"user":"hive"' "$WORK/resume.ndjson" \
    || die "the resume did not report the service account it created"
  echo "OK: the skipped create_user still named the service account"

  local token2; token2="$(token_from_stream "$WORK/resume.ndjson")"
  [ -n "$token2" ] && [ "$token1" != "$token2" ] || die "the access token was not rotated on the resume"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: $token1' http://127.0.0.1:$PORT/api/projects")" = 401 ] \
    || die "the previous run's token still works"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: $token2' http://127.0.0.1:$PORT/api/projects")" = 200 ] \
    || die "the rotated token does not work"
  echo "OK: the resume rotated the token and the old one stopped working"
  log "PASS (fresh, exact resume, mismatch rejection, completed rejection)"
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

  log "Install the healthy release, then crash before marking the install complete"
  local rc
  set +e
  DIE_AFTER=verify_auth run_provision >"$WORK/healthy.ndjson" 2>&1; rc=$?
  set -e
  [ "$rc" = 137 ] || { tail -30 "$WORK/healthy.ndjson" >&2; die "healthy setup did not stop before completion"; }
  sh_server 'test ! -e /etc/hive/.hive-install-complete' \
    || die "the rollback fixture was already marked complete"
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
  local out
  set +e
  out="$(DIE_AFTER="" HEALTH_ATTEMPTS=3 run_provision 2>&1)"; rc=$?
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

# ---------------------------------------------------------------------------
# The premise of the whole design: the operator's server is already doing
# something else, and the installer is a guest on it.
# ---------------------------------------------------------------------------

# Two neighbours: a web server on 80, and something on 5432 with no firewall
# rule of its own. The reference implementation's `ufw default deny incoming`
# plus `ufw --force enable` severs both on a server where ufw is installed but
# inactive. They are started with the system Node the installer must not touch.
start_neighbours() {
  docker exec -d "$CID" /usr/bin/node -e \
    'require("http").createServer((_,s)=>s.end("neighbour-80")).listen(80)'
  docker exec -d "$CID" /usr/bin/node -e \
    'require("http").createServer((_,s)=>s.end("neighbour-5432")).listen(5432)'
  for _ in $(seq 1 30); do
    if peer_can_reach "$SERVER_HOST" 80 && peer_can_reach "$SERVER_HOST" 5432; then return 0; fi
    sleep 1
  done
  die "the neighbouring services never became reachable from a peer"
}

assert_neighbour_80_alive() {
  local when="$1"
  [ "$(from_peer "$SERVER_HOST" 80)" = "neighbour-80" ] \
    || die "$when: the web server on port 80 is no longer reachable"
}

assert_neighbours_alive() {
  local when="$1"
  assert_neighbour_80_alive "$when"
  [ "$(from_peer "$SERVER_HOST" 5432)" = "neighbour-5432" ] \
    || die "$when: the service on port 5432 is no longer reachable"
  echo "OK: $when, both neighbouring services still answer a peer"
}

ufw_state() { sh_server 'ufw status verbose 2>/dev/null | head -3'; }
ufw_rules() { sh_server 'ufw status 2>/dev/null | tail -n +4 | grep -v "^$" | sort || true'; }

mode_neighbour() {
  build_release; build_provision; start_stack

  log "Give the server a life of its own: a web server on 80 and a service on 5432"
  sh_server 'DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 &&
             DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw >/dev/null 2>&1' \
    || die "could not install ufw in the test container"
  start_neighbours
  assert_neighbours_alive "before the install"

  # -- Phase A: ufw installed but INACTIVE ---------------------------------
  # This is the configuration the reference implementation destroys. Nothing
  # here may change: not the policy, not the enabled state, not one rule.
  log "Phase A: ufw is installed but inactive — the installer must not touch it"
  [ "$(sh_server 'ufw status')" = "Status: inactive" ] || die "ufw is not inactive to begin with"
  local rc
  set +e
  DIE_AFTER=verify_auth run_provision --port "$PORT" >"$WORK/neighbour-a.ndjson" 2>&1; rc=$?
  set -e
  [ "$rc" = 137 ] || { tail -30 "$WORK/neighbour-a.ndjson" >&2; die "phase A did not stop before completion"; }
  sh_server 'test ! -e /etc/hive/.hive-install-complete' \
    || die "phase A was marked complete"

  assert_neighbours_alive "after installing next to them"
  [ "$(sh_server 'ufw status')" = "Status: inactive" ] \
    || { ufw_state >&2; die "the installer enabled the firewall"; }
  [ -z "$(ufw_rules)" ] || { ufw_rules >&2; die "the installer added a rule to an inactive firewall"; }
  echo "OK: ufw is still inactive and still has no rules"

  # The fact must reach the stream, or the UI cannot tell the operator what is
  # and is not open.
  grep -q '"step":"firewall_rule","status":"ok".*"active":false,"ruleApplied":false,"reason":"firewall-inactive"' \
    "$WORK/neighbour-a.ndjson" || { grep firewall_rule "$WORK/neighbour-a.ndjson" >&2
      die "the inactive firewall was not reported on the progress stream"; }
  echo "OK: the stream reports the firewall as inactive with no rule applied"

  log "Hive itself came up healthy alongside them"
  local token; token="$(token_from_stream "$WORK/neighbour-a.ndjson")"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/health")" = 200 ] \
    || die "/health is not answering 200"
  peer_can_reach "$SERVER_HOST" "$PORT" /health || die "a peer cannot reach Hive on $PORT"
  [ "$(sh_server '/usr/bin/node -p "process.versions.node.split(\".\")[0]"')" = 18 ] \
    || die "the system Node.js was replaced out from under the neighbours"
  echo "OK: Hive is healthy on $PORT and the system Node is untouched"

  # -- Phase B: ufw ACTIVE, with the operator's own policy ------------------
  log "Phase B: the operator turns ufw on with their own policy, then resumes"
  sh_server "ufw allow 80/tcp >/dev/null && ufw --force enable >/dev/null" \
    || die "could not enable ufw in the test container"
  [ "$(sh_server 'ufw status | head -1')" = "Status: active" ] || die "ufw did not come up active"
  local policy_before rules_before
  policy_before="$(sh_server 'ufw status verbose | grep "^Default:"')"
  rules_before="$(ufw_rules)"
  # Only port 80 is allowed now, so 5432 is unreachable — by the operator's own
  # policy, which is the point. What matters is that Hive does not author that
  # policy, and does not change it.
  assert_neighbour_80_alive "with ufw active and port 80 explicitly allowed"
  peer_can_reach "$SERVER_HOST" 5432 \
    && die "port 5432 should be blocked by the operator's own default-deny policy"
  echo "OK: with ufw active, port 80 answers and 5432 does not — the operator's policy, not ours"

  DIE_AFTER="" run_provision --port "$PORT" >"$WORK/neighbour-b.ndjson" \
    || { tail -30 "$WORK/neighbour-b.ndjson" >&2; die "the resume failed"; }
  assert_run_ok "$WORK/neighbour-b.ndjson"

  log "Exactly one rule was added, and the policy was not touched"
  [ "$(sh_server 'ufw status verbose | grep "^Default:"')" = "$policy_before" ] \
    || die "the default policy changed: '$policy_before' -> '$(sh_server 'ufw status verbose | grep "^Default:"')'"
  local added
  added="$(comm -13 <(printf '%s\n' "$rules_before") <(ufw_rules))"
  # One `ufw allow <port>/tcp` writes a v4 and a v6 rule; both must be for our
  # port and nothing else. Any 22/tcp line here is the reference bug returning.
  if [ -n "$added" ] && ! grep -vq "^$PORT/tcp" <<<"$added"; then
    echo "OK: the only rules added are $(tr '\n' ' ' <<<"$added")"
  else
    printf '%s\n' "$added" >&2
    die "the installer added rules other than $PORT/tcp"
  fi
  grep -q "22/tcp" <<<"$added" && die "the installer added an SSH rule"
  grep -q '"ruleApplied":true,"rule":"ufw allow '"$PORT"'/tcp"' "$WORK/neighbour-b.ndjson" \
    || { grep firewall_rule "$WORK/neighbour-b.ndjson" >&2
         die "the applied rule was not reported on the progress stream"; }
  echo "OK: the applied rule was reported on the stream"

  assert_neighbour_80_alive "after the resume with ufw active"
  echo "OK: the web server on port 80 still answers a peer"
  peer_can_reach "$SERVER_HOST" "$PORT" /health \
    || die "a peer cannot reach Hive on $PORT through the active firewall"
  local token2; token2="$(token_from_stream "$WORK/neighbour-b.ndjson")"
  [ -n "$token2" ] && [ -n "$token" ] || die "no token was reported"
  echo "OK: Hive is reachable through the active firewall"

  peer_can_reach "$SERVER_HOST" 5432 \
    && die "opening Hive's port also exposed the blocked service on 5432"
  echo "OK: Hive opened only its own port"

  log "PASS (Hive installs onto a busy server without disturbing what runs there)"
}

# ---------------------------------------------------------------------------
# Preflight changes nothing
# ---------------------------------------------------------------------------

# Every path the installer could plausibly write, with mode, owner and size, so
# a created file, a changed permission or a rewritten config all show up as a
# diff. /var/log and /var/lib/systemd are excluded: the journal and systemd's
# own state churn on their own and have nothing to do with this script.
snapshot_fs() {
  sh_server 'find /etc /opt /usr/local /home /root /var/lib /srv -xdev \
    \( -path /var/lib/systemd -o -path /var/lib/dbus -o -path /var/lib/apt \) -prune -o \
    -printf "%p|%m|%U|%G|%s\n" 2>/dev/null | sort'
}

snapshot_services() {
  sh_server 'systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null | sort
             systemctl list-units --type=service --all --plain --no-legend --no-pager 2>/dev/null \
               | awk "{print \$1, \$2, \$3, \$4}" | sort'
}

# Paths that differ between two snapshots, whatever the reason.
changed_paths() {
  # diff exits 1 when the files differ and grep exits 1 when they do not, and
  # both are expected outcomes here, so neither may fail the lane.
  { diff "$1" "$2" || true; } | { grep -E '^[<>]' || true; } \
    | cut -d' ' -f2- | cut -d'|' -f1 | sort -u
}

mode_preflight() {
  build_provision; start_stack

  log "Let the server settle, then measure what changes on its own"
  in_server systemctl is-system-running --wait >/dev/null 2>&1 || true
  # A booting systemd writes /etc/.updated and rewrites /etc/mtab by itself.
  # Rather than assume which paths churn, measure them over an idle interval
  # and exclude exactly those — so the comparison below is about preflight and
  # nothing else, and the exclusion list is evidence rather than a guess.
  snapshot_fs >"$WORK/fs.idle1"
  sleep 5
  snapshot_fs >"$WORK/fs.idle2"
  changed_paths "$WORK/fs.idle1" "$WORK/fs.idle2" >"$WORK/churn.paths"
  if [ -s "$WORK/churn.paths" ]; then
    echo "NOTE: excluded $(wc -l <"$WORK/churn.paths") self-changing path(s): $(tr '\n' ' ' <"$WORK/churn.paths")"
  else
    echo "OK: the idle server changes nothing on its own; nothing is excluded"
  fi

  log "Snapshot the filesystem and the service table"
  snapshot_fs | grep -vFf "$WORK/churn.paths" - >"$WORK/fs.before" || true
  snapshot_services >"$WORK/svc.before"
  [ "$(wc -l <"$WORK/fs.before")" -gt 500 ] || die "the filesystem snapshot looks empty"
  echo "OK: $(wc -l <"$WORK/fs.before") paths and $(wc -l <"$WORK/svc.before") service entries recorded"

  log "Run preflight with default and custom paths"
  local rc
  set +e
  run_provision --preflight >"$WORK/pre.ndjson" 2>&1; rc=$?
  set -e
  [ "$rc" = 0 ] || { tail -20 "$WORK/pre.ndjson" >&2; die "preflight exited $rc; it must always exit 0"; }

  run_provision --preflight --install-dir /srv/hive-app --data-dir /mnt/hive-data \
    --ssh-public-key "$TEST_SSH_KEY" >"$WORK/pre-paths.ndjson" 2>&1

  log "Compare the snapshots"
  snapshot_fs | grep -vFf "$WORK/churn.paths" - >"$WORK/fs.after" || true
  snapshot_services >"$WORK/svc.after"
  if ! diff -u "$WORK/fs.before" "$WORK/fs.after" >"$WORK/fs.diff"; then
    head -40 "$WORK/fs.diff" >&2
    die "preflight modified the filesystem"
  fi
  if ! diff -u "$WORK/svc.before" "$WORK/svc.after" >"$WORK/svc.diff"; then
    head -40 "$WORK/svc.diff" >&2
    die "preflight modified the service table"
  fi
  echo "OK: not one path, mode, owner, size or service entry changed"

  # The things this script creates when it runs for real must all be absent.
  sh_server 'test ! -e /var/lib/hive && test ! -e /etc/hive && test ! -e /opt/hive' \
    || die "preflight created one of the installer's own directories"
  sh_server 'test ! -e /var/lib/hive/provision.log.ndjson' || die "preflight opened a log file"
  in_server id hive >/dev/null 2>&1 && die "preflight created the service account"
  echo "OK: no state directory, no log file, no service account"

  log "It still reported every relevant finding"
  grep -q '"event":"preflight","ok":true' "$WORK/pre.ndjson" \
    || { grep '"status":"fail"' "$WORK/pre.ndjson" >&2; die "preflight did not pass on a clean server"; }
  local check
  for check in os systemd arch privilege existing_install port install_dir data_dir firewall; do
    grep -q "\"check\":\"$check\"" "$WORK/pre.ndjson" || die "preflight did not report '$check'"
  done

  grep -q '"check":"firewall".*"active":\(true\|false\)' "$WORK/pre.ndjson" \
    || die "preflight did not report whether a host firewall is active"
  echo "OK: the firewall state reached the stream without a network question"

  grep -q '"check":"install_dir".*"path":"/srv/hive-app"' "$WORK/pre-paths.ndjson" \
    || die "preflight did not check the configured install directory"
  grep -q '"check":"data_dir".*"path":"/mnt/hive-data"' "$WORK/pre-paths.ndjson" \
    || die "preflight did not check the configured data directory"
  echo "OK: findings are reported, and a blocker is still a clean exit"

  log "PASS (preflight reports and changes nothing)"
}

# ---------------------------------------------------------------------------
# Non-default install and data directories, end to end
# ---------------------------------------------------------------------------

ALT_INSTALL="/srv/hive-app"
ALT_DATA="/mnt/hive-data"

mode_paths() {
  build_release; build_provision; start_stack

  log "Install into $ALT_INSTALL with data in $ALT_DATA"
  run_provision --port "$PORT" --install-dir "$ALT_INSTALL" --data-dir "$ALT_DATA" \
    --ssh-public-key "$TEST_SSH_KEY" >"$WORK/paths.ndjson" \
    || { tail -30 "$WORK/paths.ndjson" >&2; die "provisioning with non-default paths failed"; }
  assert_run_ok "$WORK/paths.ndjson"

  log "Nothing landed in the defaults"
  sh_server 'test ! -e /opt/hive' || die "/opt/hive was created despite --install-dir"
  sh_server 'test ! -e /home/hive/.hive' || die "/home/hive/.hive was created despite --data-dir"
  echo "OK: neither default path exists"

  log "Everything landed in the configured directories"
  sh_server "test -x $ALT_INSTALL/runtime/current/bin/node" || die "the private runtime is not in $ALT_INSTALL"
  sh_server "test -L $ALT_INSTALL/current" || die "the release symlink is not in $ALT_INSTALL"
  sh_server "test -x $ALT_INSTALL/hive-uninstall.sh" || die "the uninstaller is not in $ALT_INSTALL"
  [ "$(in_server systemctl show hive -p WorkingDirectory --value)" = "$ALT_INSTALL/current" ] \
    || die "the unit does not run from $ALT_INSTALL"
  [ "$(sh_server 'sed -n "s/^DATA_DIR=//p" /etc/hive/hive.env')" = "$ALT_DATA" ] \
    || die "the backend was not told to use $ALT_DATA"
  [ "$(sh_server "stat -c '%U:%G %a' $ALT_DATA")" = "hive:hive 700" ] \
    || die "$ALT_DATA is not owned by hive with mode 700"
  echo "OK: runtime, release, unit and configuration all follow the options"

  log "The backend is healthy and actually writes to $ALT_DATA"
  local token; token="$(token_from_stream "$WORK/paths.ndjson")"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$PORT/health")" = 200 ] \
    || die "/health is not answering 200"
  [ "$(sh_server "curl -s -o /dev/null -w '%{http_code}' -H 'x-hive-token: $token' http://127.0.0.1:$PORT/api/projects")" = 200 ] \
    || die "an authenticated request was not accepted"
  # ProtectSystem=strict makes the whole filesystem read-only except the paths
  # the unit declares. If ReadWritePaths missed the configured data directory,
  # the backend could reach it but not write it — which this catches.
  sh_server "runuser -u hive -- test -w $ALT_DATA" || die "$ALT_DATA is not writable by hive"
  [ -n "$(sh_server "ls -A $ALT_DATA")" ] || die "the backend wrote nothing to $ALT_DATA"
  echo "OK: the running backend uses $ALT_DATA — it holds $(sh_server "ls -A $ALT_DATA | tr '\n' ' '")"

  log "The generated uninstaller carries the real paths"
  sh_server "grep -q 'rm -rf \"$ALT_INSTALL\"' $ALT_INSTALL/hive-uninstall.sh" \
    || die "the uninstaller does not remove $ALT_INSTALL"
  sh_server "grep -q 'rm -rf \"$ALT_DATA\"' $ALT_INSTALL/hive-uninstall.sh" \
    || die "the uninstaller does not know about $ALT_DATA"
  sh_server "grep -q '/opt/hive' $ALT_INSTALL/hive-uninstall.sh" \
    && die "the uninstaller still carries the default install directory"
  echo "OK: the uninstaller was written for this install, not for the defaults"

  log "The durable identity records the non-default paths exactly"
  sh_server "grep -qx 'port=$PORT' /etc/hive/.hive-install" \
    || die "the manifest does not record the configured port"
  sh_server "grep -qx 'install_dir=$ALT_INSTALL' /etc/hive/.hive-install" \
    || die "the manifest does not record the configured install directory"
  sh_server "grep -qx 'data_dir=$ALT_DATA' /etc/hive/.hive-install" \
    || die "the manifest does not record the configured data directory"
  sh_server 'test -e /etc/hive/.hive-install-complete' \
    || die "the custom-path install was not marked complete"
  echo "OK: the completed identity carries the configured port and paths"

  log "PASS (a non-default install and data directory are honoured end to end)"
}

# ---------------------------------------------------------------------------
# The generated uninstaller
# ---------------------------------------------------------------------------

mode_uninstall() {
  build_release; build_provision; start_stack

  log "Install, with an active firewall so a rule is really added"
  sh_server 'DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 &&
             DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ufw >/dev/null 2>&1' \
    || die "could not install ufw in the test container"
  sh_server 'ufw --force enable >/dev/null' || die "could not enable ufw"
  run_provision --port "$PORT" --ssh-public-key "$TEST_SSH_KEY" >"$WORK/uninst.ndjson" \
    || { tail -30 "$WORK/uninst.ndjson" >&2; die "provisioning failed"; }
  assert_run_ok "$WORK/uninst.ndjson"
  sh_server "ufw status | grep -q '^$PORT/tcp'" || die "no firewall rule was added"

  # An operator-owned rule next to Hive's rule must survive uninstall.
  local second_port=$((PORT + 1))
  log "The operator adds an unrelated rule on port $second_port"
  sh_server "ufw allow $second_port/tcp >/dev/null" \
    || die "the operator-owned firewall rule could not be added"
  sh_server "ufw status | grep -q '^$second_port/tcp'" \
    || die "the operator-owned port rule was not added"
  echo "OK: Hive's rule and the operator's rule are both in place"

  log "Leave something behind that stands in for the operator's work"
  sh_server "runuser -u hive -- touch /home/hive/.hive/my-precious-project" \
    || die "could not write to the data directory"
  # Prove the uninstaller does not uninstall the machine along with Hive.
  sh_server 'dpkg -s git >/dev/null && dpkg -s curl >/dev/null' || die "git/curl are not installed"

  log "Keep a copy of the uninstaller, since it removes itself with the install"
  sh_server 'cp /opt/hive/hive-uninstall.sh /root/hive-uninstall-copy.sh'

  log "Run it without --purge"
  sh_server '/opt/hive/hive-uninstall.sh' >"$WORK/uninstall.log" 2>&1 \
    || { cat "$WORK/uninstall.log" >&2; die "the uninstaller failed"; }
  cat "$WORK/uninstall.log"

  log "Hive is gone"
  sh_server 'test ! -e /etc/systemd/system/hive.service' || die "the service unit survived"
  in_server systemctl is-active --quiet hive && die "the service is still running"
  sh_server 'test ! -e /opt/hive' || die "the install directory survived"
  sh_server 'test ! -e /etc/hive' || die "the configuration survived"
  sh_server 'test ! -e /var/lib/hive' || die "the provisioning state survived"
  in_server id hive >/dev/null 2>&1 && die "the service account survived"
  sh_server "ufw status | grep -q '^$PORT/tcp'" && die "the firewall rule this install added survived"
  sh_server "ufw status | grep -q '^$second_port/tcp'" \
    || die "the uninstaller removed the operator-owned firewall rule"
  [ "$(sh_server 'ufw status | head -1')" = "Status: active" ] \
    || die "the uninstaller disabled the operator's firewall"
  echo "OK: Hive is gone, and the operator-owned firewall rule remains"

  log "The operator's data and the machine's packages are not"
  sh_server 'test -f /home/hive/.hive/my-precious-project' \
    || die "the uninstaller removed the data without being asked"
  sh_server 'dpkg -s git >/dev/null && dpkg -s curl >/dev/null' \
    || die "the uninstaller removed system packages"
  sh_server 'test "$(/usr/bin/node -p "process.versions.node.split(\".\")[0]")" = 18' \
    || die "the uninstaller touched the system Node.js"
  echo "OK: the data, the packages and the system runtime are untouched"

  log "Now run it with --purge"
  sh_server '/root/hive-uninstall-copy.sh --purge' >"$WORK/purge.log" 2>&1 \
    || { cat "$WORK/purge.log" >&2; die "the purge run failed"; }
  cat "$WORK/purge.log"
  sh_server 'test ! -e /home/hive/.hive/my-precious-project' || die "--purge left the data behind"
  sh_server 'test ! -e /home/hive' || die "--purge left the service account home behind"
  sh_server 'dpkg -s git >/dev/null' || die "--purge removed system packages"
  echo "OK: --purge removed the data and still left the machine's packages alone"

  log "And the server can be provisioned again from that state"
  run_provision --port "$PORT" >"$WORK/reinstall.ndjson" \
    || { tail -30 "$WORK/reinstall.ndjson" >&2; die "re-provisioning after an uninstall failed"; }
  assert_run_ok "$WORK/reinstall.ndjson"
  in_server systemctl is-active --quiet hive || die "the reinstalled service is not active"
  echo "OK: a purged server provisions cleanly again"

  log "PASS (uninstall removes what was installed, keeps the data, and --purge removes that too)"
}

command -v docker >/dev/null 2>&1 || die "docker is required to run this lane"
docker info >/dev/null 2>&1 || die "the docker daemon is not reachable"

case "$MODE" in
  install)   mode_install ;;
  guards)    mode_guards ;;
  checksum)  mode_checksum ;;
  rollback)  mode_rollback ;;
  chaos)     mode_chaos ;;
  neighbour) mode_neighbour ;;
  preflight) mode_preflight ;;
  paths)     mode_paths ;;
  uninstall) mode_uninstall ;;
  *) echo "usage: $0 [install|guards|checksum|rollback|chaos|neighbour|preflight|paths|uninstall]" >&2
     exit 2 ;;
esac
