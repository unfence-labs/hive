# shellcheck shell=bash
# Hive provision steps. Each step: optional guard_<id> (skip if satisfied),
# optional title_<id>, and step_<id> (the action).

# Flags/options (set by parse_args in provision.sh):
#   OPT_LOCAL_DEV OPT_TEST_SKIP_UFW OPT_TEST_SKIP_NODE
#   OPT_HOST OPT_PORT OPT_RELEASE_FILE

APT_BASELINE="build-essential python3 python-is-python3 pkg-config libssl-dev \
git unzip xz-utils jq ripgrep fd-find sqlite3 git-delta fzf tree curl gnupg ca-certificates ufw util-linux iproute2"

HIVE_HOME="/home/hive"
HIVE_DATA_DIR="$HIVE_HOME/.hive"
HIVE_OPT="/opt/hive"
# Durable "installed by Hive" marker: survives the state-dir wipe on a
# SCRIPT_VERSION bump, so probe_env can tell our own install (a resume/update)
# apart from a foreign occupant.
HIVE_INSTALL_MARKER="/etc/hive/.hive-install"
HIVE_RESTART_REQUIRED="$HIVE_VAR_DIR/restart-required"
HIVE_PENDING_RELEASE="$HIVE_VAR_DIR/pending-release"
HIVE_ACTIVATED_RELEASE="$HIVE_VAR_DIR/activated-release"

# ---------------------------------------------------------------------------

title_probe_os() { echo "Check the operating system"; }
step_probe_os() {
  [ -r /etc/os-release ] || die UNSUPPORTED_OS "no /etc/os-release"
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12) : ;;
    *) die UNSUPPORTED_OS "unsupported: ${ID:-?} ${VERSION_ID:-?}" ;;
  esac
  [ -d /run/systemd/system ] || die UNSUPPORTED_OS "systemd is required"
  local arch; arch="$(uname -m)"
  case "$arch" in
    x86_64 | aarch64) : ;;
    *) die UNSUPPORTED_ARCH "unsupported arch: $arch" ;;
  esac
  STEP_DATA="$(printf '{"os":"%s %s","arch":"%s"}' "${ID}" "${VERSION_ID}" "$arch")"
}

# ---------------------------------------------------------------------------

title_probe_env() { echo "Check the server is pristine"; }
step_probe_env() {
  # Our own prior install is a resume/update, not a conflict.
  if [ -e "$HIVE_INSTALL_MARKER" ]; then
    STEP_DATA='{"reinstall":true}'
    return 0
  fi
  if [ -e /etc/systemd/system/hive.service ] || [ -d "$HIVE_OPT" ]; then
    die EXISTING_INSTALL "Hive is already installed on this server"
  fi
  # A busy target port on a pristine box means something else runs here.
  # No `grep -q`: its early exit can SIGPIPE ss, turning a found port into a
  # non-zero pipeline under pipefail (busy port read as free).
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | grep ":${OPT_PORT}\b" >/dev/null; then
      die SERVER_NOT_PRISTINE "port ${OPT_PORT} is already in use"
    fi
  else
    emit_log probe_env "ss unavailable; skipping the port ${OPT_PORT} availability check"
  fi
}

# ---------------------------------------------------------------------------

title_remove_legacy_helpers() { echo "Remove legacy privileged helpers"; }
guard_remove_legacy_helpers() {
  [ ! -e /usr/lib/hive/helpers ] && [ ! -e /etc/sudoers.d/hive ]
}
step_remove_legacy_helpers() {
  rm -rf /usr/lib/hive/helpers
  rm -f /etc/sudoers.d/hive
}

# ---------------------------------------------------------------------------

title_apt_baseline() { echo "Install base packages"; }
guard_apt_baseline() {
  local p
  for p in $APT_BASELINE; do dpkg -s "$p" >/dev/null 2>&1 || return 1; done
  command -v fd >/dev/null 2>&1
}
step_apt_baseline() {
  STEP_ERR_CODE=APT_FAILURE
  run_logged apt_baseline apt-get update -q -o DPkg::Lock::Timeout=300
  # shellcheck disable=SC2086
  run_logged apt_baseline apt_install $APT_BASELINE
  STEP_ERR_CODE=""
  # Debian ships fd-find as `fdfind`; agents expect `fd`.
  if command -v fdfind >/dev/null 2>&1 && ! command -v fd >/dev/null 2>&1; then
    ln -sf "$(command -v fdfind)" /usr/local/bin/fd
  fi
}

# ---------------------------------------------------------------------------

title_install_node() { echo "Install Node.js 22"; }
guard_install_node() {
  command -v node >/dev/null 2>&1 && \
    [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 22 ]
}
step_install_node() {
  if [ "${OPT_TEST_SKIP_NODE}" = 1 ]; then
    guard_install_node || die UNKNOWN "--test-skip-node set but no node>=22 present"
    STEP_DATA="$(printf '{"nodeVersion":"%s","skipped":true}' "$(node -v)")"
    return 0
  fi
  STEP_ERR_CODE=APT_FAILURE
  run_logged install_node bash -o pipefail -c \
    'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -'
  run_logged install_node apt_install nodejs
  guard_install_node || die APT_FAILURE "Node.js 22 or newer is unavailable after installation"
  STEP_ERR_CODE=""
  STEP_DATA="$(printf '{"nodeVersion":"%s"}' "$(node -v)")"
}

# ---------------------------------------------------------------------------

title_install_gh() { echo "Install GitHub CLI"; }
guard_install_gh() { command -v gh >/dev/null 2>&1; }
step_install_gh() {
  STEP_ERR_CODE=APT_FAILURE
  install -d -m 0755 /etc/apt/keyrings
  run_logged install_gh curl -fsSL -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    https://cli.github.com/packages/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n' \
    "$(dpkg --print-architecture)" >/etc/apt/sources.list.d/github-cli.list
  run_logged install_gh apt-get update -q -o DPkg::Lock::Timeout=300
  run_logged install_gh apt_install gh
  STEP_ERR_CODE=""
}

# ---------------------------------------------------------------------------

title_create_user() { echo "Create the hive service user"; }
guard_create_user() {
  id hive >/dev/null 2>&1 && [ -d "$HIVE_DATA_DIR" ] && \
    [ "$(stat -c '%U:%G' "$HIVE_DATA_DIR" 2>/dev/null)" = "hive:hive" ]
}
step_create_user() {
  id hive >/dev/null 2>&1 || useradd -m -s /bin/bash hive
  install -d -o hive -g hive -m 755 "$HIVE_DATA_DIR"
}

# ---------------------------------------------------------------------------

title_install_tailscale() { echo "Install Tailscale"; }
guard_install_tailscale() {
  [ "$OPT_LOCAL_DEV" = 1 ] || \
    { command -v tailscale >/dev/null 2>&1 && systemctl is-active --quiet tailscaled; }
}
step_install_tailscale() {
  [ "$OPT_LOCAL_DEV" = 1 ] && { STEP_DATA='{"localDev":true}'; return 0; }
  # This step runs before apt_baseline (fail fast on a dead auth key) so curl
  # may not exist yet on minimal images.
  if ! command -v curl >/dev/null 2>&1; then
    STEP_ERR_CODE=APT_FAILURE
    run_logged install_tailscale apt-get update -q -o DPkg::Lock::Timeout=300
    run_logged install_tailscale apt_install curl ca-certificates
    STEP_ERR_CODE=""
  fi
  run_logged install_tailscale bash -o pipefail -c \
    'curl -fsSL https://tailscale.com/install.sh | sh'
  systemctl enable --now tailscaled
}

title_tailscale_up() { echo "Join the Tailscale network"; }

# On resume the step is skipped but the wizard still needs the tailnet IP to
# target the backend (UFW only opens the tailscale0 interface in tailnet mode).
skipdata_tailscale_up() {
  # `|| true`: a not-yet-assigned IP makes the pipeline non-zero under pipefail,
  # which must not abort this skip-time emit (matches step_tailscale_up).
  local ip; ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  if [ -n "$ip" ]; then printf '{"tailnetIp":"%s"}' "$ip"; else printf '{}'; fi
}

guard_tailscale_up() {
  [ "$OPT_LOCAL_DEV" = 1 ] || \
    { command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; }
}
step_tailscale_up() {
  [ "$OPT_LOCAL_DEV" = 1 ] && { STEP_DATA='{"localDev":true}'; return 0; }
  # Already joined on a resumed run: reuse the tailnet IP, no key needed.
  # `|| true`: on a fresh server tailscale ip exits non-zero, which set -e must not kill.
  local existing_ip; existing_ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  if [ -n "$existing_ip" ]; then
    STEP_DATA="$(printf '{"tailnetIp":"%s"}' "$existing_ip")"
    return 0
  fi
  [ -n "${TS_AUTHKEY:-}" ] || die TS_AUTHKEY_INVALID "TS_AUTHKEY not provided"
  SENSITIVE_FILE="$(mktemp "$HIVE_VAR_DIR/tailscale-auth.XXXXXX")"
  chmod 600 "$SENSITIVE_FILE"
  printf '%s' "$TS_AUTHKEY" >"$SENSITIVE_FILE"
  TS_AUTHKEY=""
  unset TS_AUTHKEY
  STEP_ERR_CODE=TS_AUTHKEY_INVALID
  # The secret is read from a private file, so it never enters the process
  # arguments, environment of tailscale, provision log, or shell trace.
  local ts_err
  if ! ts_err="$(tailscale up --auth-key="file:$SENSITIVE_FILE" --hostname=hive 2>&1)"; then
    rm -f "$SENSITIVE_FILE"; SENSITIVE_FILE=""
    die TS_AUTHKEY_INVALID "tailscale up: ${ts_err:0:300}"
  fi
  rm -f "$SENSITIVE_FILE"; SENSITIVE_FILE=""
  STEP_ERR_CODE=""
  # `|| true`: let the explicit check below own the failure with TS_DAEMON_DOWN,
  # instead of the pipeline's non-zero exit tripping the ERR trap as UNKNOWN.
  local ip; ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
  [ -n "$ip" ] || die TS_DAEMON_DOWN "no tailnet IP assigned"
  STEP_DATA="$(printf '{"tailnetIp":"%s"}' "$ip")"
}

# ---------------------------------------------------------------------------

title_configure_ufw() { echo "Configure the firewall"; }

# Re-run when the expected inbound rule is missing — e.g. a resume after the
# rules changed between script versions or modes.
guard_configure_ufw() {
  [ "$OPT_TEST_SKIP_UFW" = 1 ] && return 0
  if [ "$OPT_LOCAL_DEV" = 1 ]; then
    ufw status | grep -Eq "^$OPT_PORT/tcp[[:space:]]+ALLOW"
  else
    ufw status | grep -q "on tailscale0"
  fi
}

step_configure_ufw() {
  [ "$OPT_TEST_SKIP_UFW" = 1 ] && { STEP_DATA='{"testSkipped":true}'; return 0; }
  STEP_ERR_CODE=UFW_FAILURE
  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw allow ssh
  if [ "$OPT_LOCAL_DEV" = 1 ]; then
    # No tailnet: the wizard connects to the backend on its LAN/VM IP.
    ufw allow "$OPT_PORT/tcp"
  else
    ufw allow in on tailscale0
  fi
  ufw --force enable
  STEP_ERR_CODE=""
}

# ---------------------------------------------------------------------------

title_install_release() { echo "Install the Hive backend"; }

verify_release_structure() {
  local rel="$1"
  [ -f "$rel/dist/index.js" ] || return 1
  [ -f "$rel/package.json" ] || return 1
  jq -e --arg version "$HIVE_VERSION" '.version == $version' \
    "$rel/package.json" >/dev/null 2>&1 || return 1
}

verify_release_runtime() {
  local rel="$1"
  runuser -u hive -- env RELEASE_DIR="$rel" node \
    -e 'require(process.env.RELEASE_DIR + "/node_modules/node-pty")' >/dev/null 2>&1 || return 1
  runuser -u hive -- env RELEASE_DIR="$rel" node \
    -e 'require(process.env.RELEASE_DIR + "/node_modules/sharp")' >/dev/null 2>&1 || return 1
}

verify_release_dir() {
  verify_release_structure "$1" && verify_release_runtime "$1"
}

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

guard_install_release() {
  local current recorded current_sum
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  [ -n "$current" ] || return 1
  [ "$(cat "$current/.hive-version" 2>/dev/null || true)" = "$HIVE_VERSION" ] || return 1
  if [ -n "$OPT_RELEASE_FILE" ] && [ -f "$OPT_RELEASE_FILE" ]; then
    recorded="$(cat "$current/.tarball.sha256" 2>/dev/null || true)"
    current_sum="$(sha256sum "$OPT_RELEASE_FILE" | cut -d' ' -f1)"
    [ -n "$recorded" ] && [ "$recorded" = "$current_sum" ] || return 1
  fi
  verify_release_dir "$current"
}
step_install_release() {
  local tarball checksum arch_tag base_url asset_url expected actual rel staging current
  # The marker must exist before $HIVE_OPT does: a run that dies mid-step would
  # otherwise read as a foreign install on the next version-bumped re-run.
  install -d -m 755 /etc/hive
  : >"$HIVE_INSTALL_MARKER"
  chmod 600 "$HIVE_INSTALL_MARKER"
  install -d -o hive -g hive "$HIVE_OPT/releases" "$HIVE_OPT/shared"
  ln -sfn "$HIVE_DATA_DIR" "$HIVE_OPT/shared/data"

  if [ -n "$OPT_RELEASE_FILE" ]; then
    tarball="$OPT_RELEASE_FILE"
    [ -f "$tarball" ] || die RELEASE_DOWNLOAD_FAILED "release file not found: $tarball"
    checksum="$(sha256sum "$tarball" | cut -d' ' -f1)"
  else
    [ "$HIVE_VERSION" != "0.0.0-dev" ] || die RELEASE_DOWNLOAD_FAILED \
      "dev build has no downloadable release: run 'make release-tarball' in the repo, then Retry (or set HIVE_DEV_RELEASE_TARBALL to a tarball path before launching the app)"
    case "$(uname -m)" in
      x86_64) arch_tag=x64 ;;
      aarch64) arch_tag=arm64 ;;
      *) die UNSUPPORTED_ARCH "unsupported arch: $(uname -m)" ;;
    esac
    base_url="https://github.com/0xlny/hive/releases/download/v$HIVE_VERSION"
    # Test-only origin override, gated like --dev-release-file: prerelease only.
    if [ -n "${HIVE_TEST_RELEASE_BASE_URL:-}" ] && [[ "$HIVE_VERSION" == *-* ]]; then
      base_url="$HIVE_TEST_RELEASE_BASE_URL"
    fi
    asset_url="$base_url/hive-backend-$HIVE_VERSION-linux-$arch_tag.tar.gz"
    STEP_ERR_CODE=RELEASE_DOWNLOAD_FAILED
    DOWNLOAD_FILE="$(mktemp "$HIVE_VAR_DIR/release.XXXXXX.tar.gz")"
    run_logged install_release curl -fsSL -o "$DOWNLOAD_FILE" "$asset_url"
    STEP_ERR_CODE=""
    expected="$(curl -fsSL "$asset_url.sha256" 2>/dev/null | cut -d' ' -f1 || true)"
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die CHECKSUM_MISMATCH \
      "invalid or missing checksum from $asset_url.sha256"
    actual="$(sha256sum "$DOWNLOAD_FILE" | cut -d' ' -f1)"
    expected="${expected,,}"
    [ "$expected" = "$actual" ] || die CHECKSUM_MISMATCH \
      "release checksum mismatch: expected $expected, got $actual"
    tarball="$DOWNLOAD_FILE"
    checksum="$actual"
  fi

  rel="$HIVE_OPT/releases/$HIVE_VERSION-$checksum"
  if ! verify_release_dir "$rel"; then
    STEP_ERR_CODE=RELEASE_DOWNLOAD_FAILED
    rm -rf "$rel"
    find "$HIVE_OPT/releases" -maxdepth 1 -type d -name ".staging-$HIVE_VERSION-*" -exec rm -rf {} +
    staging="$(mktemp -d "$HIVE_OPT/releases/.staging-$HIVE_VERSION-$checksum.XXXXXX")"
    # Belt-and-suspenders behind the checksum: never extract absolute or
    # parent-escaping member paths as root.
    if tar -tzf "$tarball" | grep -E '^/|(^|/)\.\.(/|$)' >/dev/null; then
      die RELEASE_DOWNLOAD_FAILED "release archive contains unsafe member paths"
    fi
    tar --no-same-owner --no-same-permissions -xzf "$tarball" -C "$staging"
    printf '%s\n' "$HIVE_VERSION" >"$staging/.hive-version"
    printf '%s\n' "$checksum" >"$staging/.tarball.sha256"
    verify_release_structure "$staging" || die RELEASE_DOWNLOAD_FAILED \
      "release archive is incomplete"
    chown -R hive:hive "$staging"
    if [ -n "$OPT_RELEASE_FILE" ] && ! verify_release_runtime "$staging"; then
      run_logged install_release runuser -u hive -- env HOME="$HIVE_HOME" \
        npm --prefix "$staging" rebuild node-pty
    fi
    verify_release_runtime "$staging" || die RELEASE_DOWNLOAD_FAILED \
      "release native modules do not load as the hive service user"
    mv "$staging" "$rel"
    STEP_ERR_CODE=""
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
}

# ---------------------------------------------------------------------------

title_write_secrets() { echo "Write service configuration"; }

hive_env_base() {
  local host="$OPT_HOST" token="${HIVE_AUTH_TOKEN_SHA256:-}"
  [ "$OPT_LOCAL_DEV" != 1 ] && host="0.0.0.0"
  # A resume that does not re-pass the token hash must not silently disable
  # auth on a token-protected install: keep the value already on disk.
  if [ -z "$token" ] && [ -f /etc/hive/hive.env ]; then
    token="$(sed -n 's/^HIVE_AUTH_TOKEN_SHA256=//p' /etc/hive/hive.env)"
  fi
  cat <<EOF
NODE_ENV=production
HOST=$host
PORT=$OPT_PORT
DATA_DIR=$HIVE_DATA_DIR
HIVE_AUTH_TOKEN_SHA256=$token
PATH=/home/hive/.local/bin:/usr/local/bin:/usr/bin:/bin
EOF
}

guard_write_secrets() {
  [ -f /etc/hive/hive.env ] && cmp -s <(hive_env_base) /etc/hive/hive.env
}

step_write_secrets() {
  : >"$HIVE_RESTART_REQUIRED"
  install -d -m 755 /etc/hive
  # Durable "installed by Hive" marker so a later version-bumped re-run (which
  # wipes the state dir) is recognized by probe_env as a resume, not a conflict.
  : >"$HIVE_INSTALL_MARKER"
  chmod 600 "$HIVE_INSTALL_MARKER"
  local tmp; tmp="$(mktemp)"; hive_env_base >"$tmp"
  install -m 600 "$tmp" /etc/hive/hive.env
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------

title_write_units() { echo "Install the systemd services"; }
hive_unit() {
  cat <<EOF
[Unit]
Description=Hive backend
Wants=network-online.target
After=network-online.target

[Service]
User=hive
WorkingDirectory=$HIVE_OPT/current
ExecStart=$(command -v node) --enable-source-maps dist/index.js
EnvironmentFile=/etc/hive/hive.env
Restart=on-failure
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=3
MemoryMax=3G
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$HIVE_HOME $HIVE_OPT/shared
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
}
guard_write_units() {
  [ -f /etc/systemd/system/hive.service ] && cmp -s <(hive_unit) /etc/systemd/system/hive.service
}
step_write_units() {
  : >"$HIVE_RESTART_REQUIRED"
  hive_unit >/etc/systemd/system/hive.service
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
  systemctl restart hive
  rm -f "$HIVE_RESTART_REQUIRED"
  STEP_ERR_CODE=""
}

# ---------------------------------------------------------------------------

title_health_check() { echo "Verify Hive is healthy"; }
health_matches_version() {
  local expected="$1" body
  body="$(curl -fsS "http://127.0.0.1:$OPT_PORT/health" 2>/dev/null)" || return 1
  printf '%s' "$body" | jq -e --arg version "$expected" \
    '.status == "ok" and .version == $version' >/dev/null 2>&1
}

guard_health_check() {
  local current activated
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  activated="$(cat "$HIVE_ACTIVATED_RELEASE" 2>/dev/null || true)"
  [ -n "$current" ] && [ "$current" = "$activated" ] && \
    [ ! -e "$HIVE_PENDING_RELEASE" ] && \
    health_matches_version "$HIVE_VERSION"
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
  local previous previous_version
  previous="$(readlink -f "$HIVE_OPT/previous" 2>/dev/null || true)"
  [ -n "$previous" ] && [ -d "$previous" ] || return 1
  previous_version="$(cat "$previous/.hive-version" 2>/dev/null || true)"
  [ -n "$previous_version" ] || return 1
  emit_log health_check "Health check failed; restoring the previous release"
  atomic_symlink "$previous" "$HIVE_OPT/current"
  rm -f "$HIVE_PENDING_RELEASE" "$HIVE_RESTART_REQUIRED"
  systemctl restart hive || return 1
  local i
  for i in $(seq 1 10); do
    if health_matches_version "$previous_version"; then
      rm -f "$HIVE_OPT/previous"
      return 0
    fi
    sleep 1
  done
  return 1
}

step_health_check() {
  local i attempts="${HIVE_HEALTH_ATTEMPTS:-15}"
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || attempts=15
  for i in $(seq 1 "$attempts"); do
    if health_matches_version "$HIVE_VERSION"; then
      local current pending
      current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
      pending="$(cat "$HIVE_PENDING_RELEASE" 2>/dev/null || true)"
      if [ -n "$pending" ] && [ "$pending" != "$current" ]; then
        die HEALTH_TIMEOUT "release activation intent does not match the current release"
      fi
      atomic_marker "$HIVE_ACTIVATED_RELEASE" "$current"
      rm -f "$HIVE_OPT/previous"
      rm -f "$HIVE_PENDING_RELEASE"
      prune_releases
      STEP_DATA="$(printf '{"attempts":%d}' "$i")"
      return 0
    fi
    sleep 2
  done
  if [ -n "$(readlink -f "$HIVE_OPT/previous" 2>/dev/null || true)" ]; then
    if rollback_release; then
      die HEALTH_TIMEOUT "new release was unhealthy; the previous release was restored"
    fi
    die HEALTH_TIMEOUT "new release was unhealthy and the previous release could not be restored"
  fi
  die HEALTH_TIMEOUT "Hive did not become healthy on 127.0.0.1:$OPT_PORT"
}
