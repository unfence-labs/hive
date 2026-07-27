# shellcheck shell=bash
# shellcheck disable=SC2034  # globals are shared across the bundled fragments
# Hive provision steps. Each step is `step_<id>`, with an optional `guard_<id>`
# (skip when it succeeds) and `title_<id>`. A guard that always returns 1 marks
# a step that must re-run on every invocation.
#
# Options come from parse_args in main.sh:
#   OPT_HOST OPT_PORT OPT_RELEASE_FILE, plus HIVE_VERSION and ARCH_TAG.

# Base packages. Deliberately minimal: everything Hive itself runs lives under
# /opt/hive, so the only system packages are the ones the backend shells out to
# (git) and the ones this script needs to fetch and unpack its own payloads.
APT_BASELINE="ca-certificates curl git xz-utils iproute2"

# Node is pinned: the release tarball's native modules (node-pty, sharp) are
# compiled in CI against this major's ABI. Bumping the version means bumping
# both digests and RELEASE_NODE_MAJOR in scripts/release/build-backend-tarball.sh.
# Digests are pinned rather than fetched from SHASUMS256.txt so a compromised
# mirror cannot serve a matching tarball/checksum pair over the same TLS session.
NODE_VERSION="22.23.1"
NODE_SHA256_X64="9749e988f437343b7fa832c69ded82a312e41a03116d766797ac14f6f9eee578"
NODE_SHA256_ARM64="0294e8b915ab75f92c7513d2fcb830ae06e10684e6c603e99a87dbf8835389c1"

# GitHub CLI, installed from its official release tarball for the same reason:
# no vendor apt repository is added to the operator's machine.
GH_VERSION="2.96.0"
GH_SHA256_X64="83d5c2ccad5498f58bf6368acb1ab32588cf43ab3a4b1c301bf36328b1c8bd60"
GH_SHA256_ARM64="06f86ec7103d41993b76cd78072f43595c34aaa56506d971d9860e67140bf909"

HIVE_USER="hive"
HIVE_HOME="/home/hive"
HIVE_DATA_DIR="$HIVE_HOME/.hive"
HIVE_TOOLS_DIR="$HIVE_HOME/.local"
HIVE_OPT="/opt/hive"
HIVE_RUNTIME_DIR="$HIVE_OPT/runtime"
HIVE_NODE_BIN="$HIVE_RUNTIME_DIR/current/bin/node"
HIVE_ETC_DIR="/etc/hive"
HIVE_ENV_FILE="$HIVE_ETC_DIR/hive.env"
HIVE_UNIT_FILE="/etc/systemd/system/hive.service"
# The service PATH puts Hive's own runtime and tools ahead of the system ones,
# and never removes the system ones.
HIVE_SERVICE_PATH="$HIVE_TOOLS_DIR/bin:$HIVE_RUNTIME_DIR/current/bin:/usr/local/bin:/usr/bin:/bin"

# Durable "installed by Hive" marker: survives the state-dir wipe on a
# SCRIPT_VERSION bump, so probe_env can tell our own install (a resume/update)
# apart from a foreign occupant of /opt/hive.
HIVE_INSTALL_MARKER="$HIVE_ETC_DIR/.hive-install"
HIVE_RESTART_REQUIRED="$HIVE_VAR_DIR/restart-required"
HIVE_PENDING_RELEASE="$HIVE_VAR_DIR/pending-release"
HIVE_ACTIVATED_RELEASE="$HIVE_VAR_DIR/activated-release"

# Digest written to hive.env; set by generate_token, consumed by write_secrets.
HIVE_AUTH_TOKEN_SHA256=""

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

atomic_symlink() {
  local target="$1" link="$2" tmp="$2.tmp.$$"
  rm -f "$tmp"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$link"
}

atomic_marker() {
  local path="$1" value="$2" tmp="$1.tmp.$$"
  printf '%s\n' "$value" >"$tmp"
  mv -f "$tmp" "$path"
}

# Download to $DOWNLOAD_FILE and verify it against a pinned lowercase digest.
# Verification always happens before the caller unpacks anything.
download_verified() {
  # download_verified <stepId> <url> <expected-sha256> <errorCode>
  local step="$1" url="$2" expected="$3" code="$4" actual
  DOWNLOAD_FILE="$(mktemp "$HIVE_VAR_DIR/download.XXXXXX")"
  STEP_ERR_CODE="$code"
  run_logged "$step" curl -fsSL --retry 3 --retry-delay 2 -o "$DOWNLOAD_FILE" "$url"
  STEP_ERR_CODE=""
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die CHECKSUM_MISMATCH "no usable checksum for $url"
  actual="$(sha256_of "$DOWNLOAD_FILE")"
  [ "$expected" = "$actual" ] || die CHECKSUM_MISMATCH \
    "checksum mismatch for $url: expected $expected, got $actual"
}

# Refuse absolute or parent-escaping archive members. Belt and suspenders
# behind the checksum: nothing extracted as root may escape its target.
assert_safe_archive() {
  # assert_safe_archive <tarball> <tar-flag> <errorCode>
  local tarball="$1" flag="$2" code="$3"
  if tar "$flag" -tf "$tarball" | grep -E '^/|(^|/)\.\.(/|$)' >/dev/null; then
    die "$code" "archive contains unsafe member paths: $tarball"
  fi
}

as_hive() {
  # Run a command as the service account with Hive's own PATH and HOME. stdin
  # is /dev/null so a child can never consume a `curl | bash` script body.
  runuser -u "$HIVE_USER" -- env HOME="$HIVE_HOME" PATH="$HIVE_SERVICE_PATH" "$@" </dev/null
}

# ---------------------------------------------------------------------------

title_probe_os() { echo "Check the server"; }
step_probe_os() {
  [ -r /etc/os-release ] || die UNSUPPORTED_OS \
    "no /etc/os-release: Hive needs Ubuntu 22.04/24.04 or Debian 12/13"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) : ;;
    *) die UNSUPPORTED_OS \
      "unsupported operating system ${ID:-?} ${VERSION_ID:-?}: Hive needs Ubuntu 22.04/24.04 or Debian 12/13" ;;
  esac
  [ -d /run/systemd/system ] || die UNSUPPORTED_OS \
    "systemd is required: Hive installs itself as a systemd service"
  [ -n "$ARCH_TAG" ] || die UNSUPPORTED_ARCH \
    "unsupported architecture $(uname -m): Hive needs x86-64 or arm64"
  STEP_DATA="$(printf '{"os":"%s %s","arch":"%s"}' "${ID}" "${VERSION_ID}" "$ARCH_TAG")"
}

# ---------------------------------------------------------------------------

title_probe_env() { echo "Check for conflicts"; }
step_probe_env() {
  # Our own prior install is a resume/update, not a conflict.
  if [ -e "$HIVE_INSTALL_MARKER" ]; then
    STEP_DATA='{"reinstall":true}'
    return 0
  fi
  if [ -e "$HIVE_UNIT_FILE" ] || [ -d "$HIVE_OPT" ]; then
    die EXISTING_INSTALL "$HIVE_OPT or $HIVE_UNIT_FILE already exists but was not created by Hive"
  fi
  # This server is expected to be running other things; only the port Hive
  # wants has to be free. No `grep -q`: its early exit can SIGPIPE ss, turning
  # a found port into a non-zero pipeline under pipefail (busy port read as free).
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | grep ":${OPT_PORT}\b" >/dev/null; then
      die PORT_IN_USE "port ${OPT_PORT} is already in use by another service"
    fi
  else
    emit_log probe_env "ss unavailable; skipping the port ${OPT_PORT} availability check"
  fi
}

# ---------------------------------------------------------------------------

title_apt_baseline() { echo "Install base packages"; }
guard_apt_baseline() {
  local p
  for p in $APT_BASELINE; do dpkg -s "$p" >/dev/null 2>&1 || return 1; done
}
step_apt_baseline() {
  STEP_ERR_CODE=APT_FAILURE
  run_logged apt_baseline apt-get update -q -o DPkg::Lock::Timeout=300
  # shellcheck disable=SC2086  # deliberate word splitting of the package list
  run_logged apt_baseline apt_install $APT_BASELINE
  STEP_ERR_CODE=""
}

# ---------------------------------------------------------------------------

title_create_user() { echo "Create the hive service account"; }
guard_create_user() {
  id "$HIVE_USER" >/dev/null 2>&1 && [ -d "$HIVE_DATA_DIR" ] && \
    [ "$(stat -c '%U:%G' "$HIVE_DATA_DIR" 2>/dev/null)" = "$HIVE_USER:$HIVE_USER" ]
}
step_create_user() {
  id "$HIVE_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$HIVE_USER"
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 700 "$HIVE_DATA_DIR"
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 755 "$HIVE_TOOLS_DIR" "$HIVE_TOOLS_DIR/bin"
}

# ---------------------------------------------------------------------------

title_install_node() { echo "Install Hive's private Node.js runtime"; }

# The runtime lives inside Hive's install directory. The system Node — if the
# server has one at all — is never read, replaced, or upgraded, and no vendor
# package repository is added to the machine.
guard_install_node() {
  [ -x "$HIVE_NODE_BIN" ] && \
    [ "$("$HIVE_NODE_BIN" -p 'process.versions.node' 2>/dev/null || true)" = "$NODE_VERSION" ]
}
step_install_node() {
  local expected url dir staging
  case "$ARCH_TAG" in
    x64) expected="$NODE_SHA256_X64" ;;
    arm64) expected="$NODE_SHA256_ARM64" ;;
    *) die UNSUPPORTED_ARCH "no pinned Node runtime for $ARCH_TAG" ;;
  esac
  url="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH_TAG.tar.xz"
  download_verified install_node "$url" "$expected" NODE_INSTALL_FAILED

  STEP_ERR_CODE=NODE_INSTALL_FAILED
  assert_safe_archive "$DOWNLOAD_FILE" -J NODE_INSTALL_FAILED
  install -d -m 755 "$HIVE_RUNTIME_DIR"
  dir="$HIVE_RUNTIME_DIR/node-v$NODE_VERSION-linux-$ARCH_TAG"
  rm -rf "$dir"
  find "$HIVE_RUNTIME_DIR" -mindepth 1 -maxdepth 1 -type d -name '.staging-node-*' -exec rm -rf {} +
  staging="$(mktemp -d "$HIVE_RUNTIME_DIR/.staging-node-XXXXXX")"
  tar --no-same-owner --no-same-permissions -xJf "$DOWNLOAD_FILE" -C "$staging" --strip-components=1
  rm -f "$DOWNLOAD_FILE"; DOWNLOAD_FILE=""
  chmod -R go-w "$staging"
  chmod 755 "$staging"
  [ -x "$staging/bin/node" ] || die NODE_INSTALL_FAILED "the Node tarball contains no bin/node"
  mv "$staging" "$dir"
  atomic_symlink "$dir" "$HIVE_RUNTIME_DIR/current"
  STEP_ERR_CODE=""

  guard_install_node || die NODE_INSTALL_FAILED \
    "the private Node runtime did not report $NODE_VERSION after installation"
  # Drop superseded runtimes; the active one is a symlink target, never removed.
  find "$HIVE_RUNTIME_DIR" -mindepth 1 -maxdepth 1 -type d -name 'node-v*' \
    ! -name "node-v$NODE_VERSION-linux-$ARCH_TAG" -exec rm -rf {} +
  STEP_DATA="$(printf '{"nodeVersion":"v%s","runtimeDir":"%s"}' "$NODE_VERSION" "$HIVE_RUNTIME_DIR/current")"
}

# ---------------------------------------------------------------------------

title_install_agent_clis() { echo "Install the agent command-line tools"; }

# Installed as the service account, into its own prefix, using Hive's private
# runtime. The backend's startup dependency check (backend/src/utils/preflight.ts)
# then passes unchanged: a server that cannot run agents must fail loudly.
guard_install_agent_clis() {
  local bin
  for bin in claude codex gh; do
    [ -x "$HIVE_TOOLS_DIR/bin/$bin" ] || return 1
  done
  as_hive claude --version >/dev/null 2>&1 && \
    as_hive codex --version >/dev/null 2>&1 && \
    as_hive gh --version >/dev/null 2>&1
}
step_install_agent_clis() {
  local expected url staging bin
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 755 "$HIVE_TOOLS_DIR" "$HIVE_TOOLS_DIR/bin"

  STEP_ERR_CODE=AGENT_CLI_INSTALL_FAILED
  run_logged install_agent_clis as_hive npm install -g --prefix "$HIVE_TOOLS_DIR" \
    --no-audit --no-fund @anthropic-ai/claude-code @openai/codex

  case "$ARCH_TAG" in
    x64) expected="$GH_SHA256_X64"; url="gh_${GH_VERSION}_linux_amd64.tar.gz" ;;
    arm64) expected="$GH_SHA256_ARM64"; url="gh_${GH_VERSION}_linux_arm64.tar.gz" ;;
    *) die UNSUPPORTED_ARCH "no pinned GitHub CLI build for $ARCH_TAG" ;;
  esac
  STEP_ERR_CODE=""
  download_verified install_agent_clis \
    "https://github.com/cli/cli/releases/download/v$GH_VERSION/$url" \
    "$expected" AGENT_CLI_INSTALL_FAILED

  STEP_ERR_CODE=AGENT_CLI_INSTALL_FAILED
  assert_safe_archive "$DOWNLOAD_FILE" -z AGENT_CLI_INSTALL_FAILED
  staging="$(mktemp -d)"
  tar --no-same-owner --no-same-permissions -xzf "$DOWNLOAD_FILE" -C "$staging" --strip-components=1
  rm -f "$DOWNLOAD_FILE"; DOWNLOAD_FILE=""
  [ -x "$staging/bin/gh" ] || die AGENT_CLI_INSTALL_FAILED "the GitHub CLI tarball contains no bin/gh"
  install -o "$HIVE_USER" -g "$HIVE_USER" -m 755 "$staging/bin/gh" "$HIVE_TOOLS_DIR/bin/gh"
  rm -rf "$staging"
  STEP_ERR_CODE=""

  for bin in claude codex gh; do
    as_hive "$bin" --version >/dev/null 2>&1 || die AGENT_CLI_INSTALL_FAILED \
      "'$bin' is not runnable as the $HIVE_USER service account after installation"
  done
  STEP_DATA="$(printf '{"gh":"%s"}' "$GH_VERSION")"
}

# ---------------------------------------------------------------------------

title_install_release() { echo "Install the Hive backend"; }

verify_release_structure() {
  local rel="$1"
  [ -f "$rel/dist/index.js" ] || return 1
  [ -f "$rel/package.json" ] || return 1
  [ "$("$HIVE_NODE_BIN" -p 'require(process.argv[1]).version' "$rel/package.json" 2>/dev/null || true)" \
    = "$HIVE_VERSION" ] || return 1
}

# The release's native addons must load under the private runtime, as the
# service account. This is the check that catches an ABI mismatch between the
# pinned runtime and the Node the tarball was compiled with.
verify_release_runtime() {
  local rel="$1"
  as_hive env RELEASE_DIR="$rel" node \
    -e 'require(process.env.RELEASE_DIR + "/node_modules/node-pty")' >/dev/null 2>&1 || return 1
  as_hive env RELEASE_DIR="$rel" node \
    -e 'require(process.env.RELEASE_DIR + "/node_modules/sharp")' >/dev/null 2>&1 || return 1
}

verify_release_dir() { verify_release_structure "$1" && verify_release_runtime "$1"; }

assert_release_abi() {
  local rel="$1" declared runtime
  declared="$("$HIVE_NODE_BIN" -p 'require(process.argv[1]).hive?.nodeAbi ?? ""' \
    "$rel/package.json" 2>/dev/null || true)"
  [ -n "$declared" ] || return 0   # older tarballs carry no manifest
  runtime="$("$HIVE_NODE_BIN" -p 'process.versions.modules')"
  [ "$declared" = "$runtime" ] || die RELEASE_DOWNLOAD_FAILED \
    "release was built for Node ABI $declared but the pinned runtime is ABI $runtime"
}

guard_install_release() {
  local current
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  [ -n "$current" ] || return 1
  [ "$(cat "$current/.hive-version" 2>/dev/null || true)" = "$HIVE_VERSION" ] || return 1
  verify_release_dir "$current"
}
step_install_release() {
  local tarball checksum base_url asset_url expected rel staging current
  # The marker must exist before $HIVE_OPT does: a run that died mid-step would
  # otherwise read as a foreign install on the next version-bumped re-run.
  install -d -m 755 "$HIVE_ETC_DIR"
  : >"$HIVE_INSTALL_MARKER"
  chmod 600 "$HIVE_INSTALL_MARKER"
  install -d -m 755 "$HIVE_OPT"
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 755 "$HIVE_OPT/releases" "$HIVE_OPT/shared"
  ln -sfn "$HIVE_DATA_DIR" "$HIVE_OPT/shared/data"

  if [ -n "$OPT_RELEASE_FILE" ]; then
    tarball="$OPT_RELEASE_FILE"
    [ -f "$tarball" ] || die RELEASE_DOWNLOAD_FAILED "release file not found: $tarball"
    checksum="$(sha256_of "$tarball")"
  else
    base_url="${HIVE_RELEASE_BASE_URL:-https://github.com/unfence-labs/hive/releases/download/v$HIVE_VERSION}"
    asset_url="$base_url/hive-backend-$HIVE_VERSION-linux-$ARCH_TAG.tar.gz"
    # The published digest is fetched first, so nothing is unpacked before the
    # download has been checked against it. A missing asset fails as a download
    # error; a present but unusable digest fails as a checksum error.
    STEP_ERR_CODE=RELEASE_DOWNLOAD_FAILED
    DOWNLOAD_FILE="$(mktemp "$HIVE_VAR_DIR/download.XXXXXX")"
    run_logged install_release curl -fsSL --retry 3 --retry-delay 2 \
      -o "$DOWNLOAD_FILE" "$asset_url.sha256"
    STEP_ERR_CODE=""
    expected="$(cut -d' ' -f1 <"$DOWNLOAD_FILE")"
    rm -f "$DOWNLOAD_FILE"; DOWNLOAD_FILE=""
    expected="${expected,,}"
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || die CHECKSUM_MISMATCH \
      "invalid or missing checksum at $asset_url.sha256"
    download_verified install_release "$asset_url" "$expected" RELEASE_DOWNLOAD_FAILED
    tarball="$DOWNLOAD_FILE"
    checksum="$expected"
  fi

  rel="$HIVE_OPT/releases/$HIVE_VERSION-$checksum"
  if ! verify_release_dir "$rel"; then
    STEP_ERR_CODE=RELEASE_DOWNLOAD_FAILED
    rm -rf "$rel"
    find "$HIVE_OPT/releases" -maxdepth 1 -type d -name ".staging-$HIVE_VERSION-*" -exec rm -rf {} +
    staging="$(mktemp -d "$HIVE_OPT/releases/.staging-$HIVE_VERSION-$checksum.XXXXXX")"
    assert_safe_archive "$tarball" -z RELEASE_DOWNLOAD_FAILED
    tar --no-same-owner --no-same-permissions -xzf "$tarball" -C "$staging"
    printf '%s\n' "$HIVE_VERSION" >"$staging/.hive-version"
    printf '%s\n' "$checksum" >"$staging/.tarball.sha256"
    STEP_ERR_CODE=""
    verify_release_structure "$staging" || die RELEASE_DOWNLOAD_FAILED \
      "the release archive is incomplete or is not version $HIVE_VERSION"
    assert_release_abi "$staging"
    chown -R "$HIVE_USER:$HIVE_USER" "$staging"
    verify_release_runtime "$staging" || die RELEASE_DOWNLOAD_FAILED \
      "the release's native modules do not load under Hive's private Node runtime"
    mv "$staging" "$rel"
  fi

  rm -f "${DOWNLOAD_FILE:-}"; DOWNLOAD_FILE=""
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  if [ "$current" != "$rel" ]; then
    # Record activation intent before changing current. A crash at any later
    # instruction leaves enough state for enable_service and health_check to
    # force a restart and verification on the next run.
    : >"$HIVE_RESTART_REQUIRED"
    atomic_marker "$HIVE_PENDING_RELEASE" "$rel"
    if [ -n "$current" ] && [ -d "$current" ]; then
      atomic_symlink "$current" "$HIVE_OPT/previous"
    else
      rm -f "$HIVE_OPT/previous"
    fi
    atomic_symlink "$rel" "$HIVE_OPT/current"
    if [ "${HIVE_TEST_DIE_DURING:-}" = "release_after_swap" ]; then
      echo "TEST: dying immediately after release symlink swap" >&2
      exit 137
    fi
  fi
  STEP_DATA="$(printf '{"version":"%s"}' "$HIVE_VERSION")"
}

# ---------------------------------------------------------------------------

title_generate_token() { echo "Generate the access token"; }

# Always re-runs: the plaintext is reported exactly once, on this run's stream,
# and cannot be recovered from a resumed run. Every run therefore rotates it.
guard_generate_token() { return 1; }

random_hex_32() {
  # Two independent sources so a missing openssl is not a silent failure.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 2>/dev/null | tr -d '\n' && return 0
  fi
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

step_generate_token() {
  # `token` is a shell local and the digest is computed with printf, a bash
  # builtin: the plaintext never becomes a process argument, and emit_secret
  # keeps it out of the log file.
  local token digest
  STEP_ERR_CODE=TOKEN_GENERATION_FAILED
  token="$(random_hex_32 || true)"
  STEP_ERR_CODE=""
  [[ "$token" =~ ^[0-9a-f]{64}$ ]] || die TOKEN_GENERATION_FAILED \
    "could not generate a random access token from openssl or /dev/urandom"
  digest="$(printf '%s' "$token" | sha256sum | cut -d' ' -f1)"
  [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || die TOKEN_GENERATION_FAILED \
    "the generated token produced no usable SHA-256 digest"
  HIVE_AUTH_TOKEN_SHA256="$digest"
  STEP_SECRET_DATA="$(printf '{"accessToken":"%s"}' "$token")"
  STEP_DATA='{"accessToken":"[redacted]"}'
}

# ---------------------------------------------------------------------------

title_write_secrets() { echo "Write the service configuration"; }

hive_env_base() {
  cat <<EOF
NODE_ENV=production
HOST=$OPT_HOST
PORT=$OPT_PORT
DATA_DIR=$HIVE_DATA_DIR
HIVE_AUTH_TOKEN_SHA256=$HIVE_AUTH_TOKEN_SHA256
HIVE_AUTOMATION_TIMEOUT_SEC=1800
HOME=$HIVE_HOME
PATH=$HIVE_SERVICE_PATH
EOF
}

# Always re-runs: generate_token rotates the digest on every run, so there is
# never a satisfied prior state to skip to.
guard_write_secrets() { return 1; }

step_write_secrets() {
  local tmp written
  : >"$HIVE_RESTART_REQUIRED"
  install -d -m 755 "$HIVE_ETC_DIR"
  : >"$HIVE_INSTALL_MARKER"
  chmod 600 "$HIVE_INSTALL_MARKER"
  tmp="$(mktemp)"
  hive_env_base >"$tmp"
  # Root-owned and readable by nobody else. systemd reads EnvironmentFile as
  # root before dropping to the service account, so hive never needs access.
  install -o root -g root -m 600 "$tmp" "$HIVE_ENV_FILE"
  rm -f "$tmp"

  # The backend treats an empty HIVE_AUTH_TOKEN_SHA256 as "no expectation
  # configured" and stays open. A malformed non-empty digest fails closed, so
  # an empty one is the dangerous case — and it is exactly what a failed
  # openssl or /dev/urandom read produces. Read the value back off disk and
  # refuse to continue unless it is a 64-character lowercase hex digest.
  written="$(sed -n 's/^HIVE_AUTH_TOKEN_SHA256=//p' "$HIVE_ENV_FILE")"
  [[ "$written" =~ ^[0-9a-f]{64}$ ]] || die TOKEN_GENERATION_FAILED \
    "$HIVE_ENV_FILE has no valid HIVE_AUTH_TOKEN_SHA256; refusing to start an unprotected server"
}

# ---------------------------------------------------------------------------

title_write_units() { echo "Install the systemd service"; }
hive_unit() {
  cat <<EOF
[Unit]
Description=Hive backend
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
User=$HIVE_USER
Group=$HIVE_USER
WorkingDirectory=$HIVE_OPT/current
ExecStart=$HIVE_RUNTIME_DIR/current/bin/node --enable-source-maps dist/index.js
EnvironmentFile=$HIVE_ENV_FILE
Restart=on-failure
RestartSec=5
MemoryMax=3G
NoNewPrivileges=true
ProtectSystem=strict
ProtectControlGroups=true
ProtectKernelTunables=true
ProtectKernelModules=true
RestrictSUIDSGID=true
ReadWritePaths=$HIVE_HOME $HIVE_OPT/shared
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
}
guard_write_units() {
  [ -f "$HIVE_UNIT_FILE" ] && cmp -s <(hive_unit) "$HIVE_UNIT_FILE"
}
step_write_units() {
  : >"$HIVE_RESTART_REQUIRED"
  hive_unit >"$HIVE_UNIT_FILE"
  systemctl daemon-reload
}

# ---------------------------------------------------------------------------

title_enable_service() { echo "Start Hive"; }
guard_enable_service() {
  local current activated
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  activated="$(cat "$HIVE_ACTIVATED_RELEASE" 2>/dev/null || true)"
  [ -n "$current" ] && [ "$current" = "$activated" ] && \
    [ ! -e "$HIVE_RESTART_REQUIRED" ] && \
    systemctl is-enabled --quiet hive && systemctl is-active --quiet hive
}
step_enable_service() {
  STEP_ERR_CODE=SERVICE_START_FAILED
  systemctl enable hive >/dev/null 2>&1
  # A previous release that crash-looped leaves the unit rate-limited, and
  # `systemctl restart` then refuses outright. Clearing that first is what makes
  # a retry actually retry.
  systemctl reset-failed hive >/dev/null 2>&1 || true
  systemctl restart hive
  rm -f "$HIVE_RESTART_REQUIRED"
  STEP_ERR_CODE=""
}

# ---------------------------------------------------------------------------

title_health_check() { echo "Wait for Hive to become healthy"; }

health_ok() {
  local body
  body="$(curl -fsS --max-time 5 "http://127.0.0.1:$OPT_PORT/health" </dev/null 2>/dev/null)" || return 1
  printf '%s' "$body" | "$HIVE_NODE_BIN" -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try { process.exit(JSON.parse(raw).status === "ok" ? 0 : 1); } catch { process.exit(1); }
    });' >/dev/null 2>&1
}

guard_health_check() {
  local current activated
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  activated="$(cat "$HIVE_ACTIVATED_RELEASE" 2>/dev/null || true)"
  [ -n "$current" ] && [ "$current" = "$activated" ] && \
    [ ! -e "$HIVE_PENDING_RELEASE" ] && health_ok
}

prune_releases() {
  local current keep=0 rel
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  while IFS= read -r rel; do
    [ "$rel" = "$current" ] && continue
    if [ "$keep" -lt 2 ]; then
      keep=$((keep + 1))
    else
      rm -rf "$rel"
    fi
  done < <(find "$HIVE_OPT/releases" -mindepth 1 -maxdepth 1 -type d ! -name '.*' \
    -printf '%T@ %p\n' | sort -rn | cut -d' ' -f2-)
}

rollback_release() {
  local previous i
  previous="$(readlink -f "$HIVE_OPT/previous" 2>/dev/null || true)"
  [ -n "$previous" ] && [ -d "$previous" ] || return 1
  emit_log health_check "Health check failed; restoring the previous release"
  atomic_symlink "$previous" "$HIVE_OPT/current"
  rm -f "$HIVE_PENDING_RELEASE" "$HIVE_RESTART_REQUIRED"
  # The release we are backing out of just crash-looped, so the unit is almost
  # certainly rate-limited: without this, the restart is refused and a
  # recoverable rollback would report itself as unrecoverable.
  systemctl reset-failed hive >/dev/null 2>&1 || true
  systemctl restart hive || return 1
  for i in $(seq 1 10); do
    if health_ok; then
      atomic_marker "$HIVE_ACTIVATED_RELEASE" "$previous"
      rm -f "$HIVE_OPT/previous"
      return 0
    fi
    sleep 2
  done
  return 1
}

step_health_check() {
  local i attempts="${HIVE_HEALTH_ATTEMPTS:-30}" current pending
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || attempts=30
  for i in $(seq 1 "$attempts"); do
    if health_ok; then
      current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
      pending="$(cat "$HIVE_PENDING_RELEASE" 2>/dev/null || true)"
      if [ -n "$pending" ] && [ "$pending" != "$current" ]; then
        die HEALTH_TIMEOUT "release activation intent does not match the current release"
      fi
      atomic_marker "$HIVE_ACTIVATED_RELEASE" "$current"
      rm -f "$HIVE_OPT/previous" "$HIVE_PENDING_RELEASE"
      prune_releases
      STEP_DATA="$(printf '{"attempts":%d,"port":%s}' "$i" "$OPT_PORT")"
      return 0
    fi
    sleep 2
  done
  run_logged health_check systemctl status hive --no-pager -l || true
  if [ -n "$(readlink -f "$HIVE_OPT/previous" 2>/dev/null || true)" ]; then
    if rollback_release; then
      die HEALTH_TIMEOUT "the new release was unhealthy; the previous release was restored"
    fi
    die HEALTH_TIMEOUT "the new release was unhealthy and the previous release could not be restored"
  fi
  die HEALTH_TIMEOUT "Hive did not become healthy on 127.0.0.1:$OPT_PORT after $attempts attempts"
}

# ---------------------------------------------------------------------------

title_verify_auth() { echo "Verify the access token is enforced"; }

# Always re-runs: a wide-open backend is the one failure this script must never
# leave behind, so it is re-proved on every run rather than trusted from state.
guard_verify_auth() { return 1; }

step_verify_auth() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1:$OPT_PORT/api/projects" </dev/null || true)"
  if [ "$code" != "401" ]; then
    systemctl stop hive || true
    die AUTH_NOT_ENFORCED \
      "an unauthenticated request to /api/projects returned $code instead of 401; the service was stopped"
  fi
  STEP_DATA='{"unauthenticatedStatus":401}'
}
