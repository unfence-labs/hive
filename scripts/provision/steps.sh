# shellcheck shell=bash
# Hive provision steps. Each step: optional guard_<id> (skip if satisfied),
# optional title_<id>, and step_<id> (the action). See plan 5.2.

# Flags/options (set by parse_args in provision.sh):
#   OPT_SKIP_TAILSCALE OPT_SKIP_UFW OPT_SKIP_NODE
#   OPT_HOST OPT_PORT OPT_RELEASE_FILE OPT_APT_BASELINE

APT_BASELINE_DEFAULT="build-essential python3 python-is-python3 pkg-config libssl-dev \
unzip xz-utils jq ripgrep fd-find sqlite3 git-delta fzf tree gnupg ca-certificates ufw"

HIVE_HOME="/home/hive"
HIVE_DATA_DIR="$HIVE_HOME/.hive"
HIVE_OPT="/opt/hive"

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
    x86_64|aarch64) : ;;
    *) die UNSUPPORTED_ARCH "unsupported arch: $arch" ;;
  esac
  STEP_DATA="$(printf '{"os":"%s %s","arch":"%s"}' "${ID}" "${VERSION_ID}" "$arch")"
}

# ---------------------------------------------------------------------------

title_probe_env() { echo "Check the server is pristine"; }
step_probe_env() {
  if [ -e /etc/systemd/system/hive.service ] || [ -d "$HIVE_OPT" ]; then
    die EXISTING_INSTALL "Hive is already installed on this server"
  fi
  # A busy target port on a pristine box means something else runs here.
  if command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":${OPT_PORT}\b"; then
    die SERVER_NOT_PRISTINE "port ${OPT_PORT} is already in use"
  fi
}

# ---------------------------------------------------------------------------

title_apt_baseline() { echo "Install base packages"; }
guard_apt_baseline() {
  local p
  for p in $APT_BASELINE; do dpkg -s "$p" >/dev/null 2>&1 || return 1; done
  command -v fd >/dev/null 2>&1
}
step_apt_baseline() {
  run_logged apt_baseline apt-get update -q -o DPkg::Lock::Timeout=300
  # shellcheck disable=SC2086
  run_logged apt_baseline apt_install $APT_BASELINE
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
  if [ "${OPT_SKIP_NODE}" = 1 ]; then
    guard_install_node || die UNKNOWN "--skip-node set but no node>=22 present"
    STEP_DATA="$(printf '{"nodeVersion":"%s","skipped":true}' "$(node -v)")"
    return 0
  fi
  run_logged install_node bash -c \
    'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -'
  run_logged install_node apt_install nodejs
  STEP_DATA="$(printf '{"nodeVersion":"%s"}' "$(node -v)")"
}

# ---------------------------------------------------------------------------

title_create_user() { echo "Create the hive service user"; }
guard_create_user() { id hive >/dev/null 2>&1; }
step_create_user() {
  id hive >/dev/null 2>&1 || useradd -m -s /bin/bash hive
  install -d -o hive -g hive -m 755 "$HIVE_DATA_DIR"
}

# ---------------------------------------------------------------------------

title_install_tailscale() { echo "Install Tailscale"; }
guard_install_tailscale() { [ "$OPT_SKIP_TAILSCALE" = 1 ] || command -v tailscale >/dev/null 2>&1; }
step_install_tailscale() {
  [ "$OPT_SKIP_TAILSCALE" = 1 ] && { STEP_DATA='{"skipped":true}'; return 0; }
  run_logged install_tailscale bash -c \
    'curl -fsSL https://tailscale.com/install.sh | sh'
  systemctl enable --now tailscaled
}

title_tailscale_up() { echo "Join the Tailscale network"; }
guard_tailscale_up() {
  [ "$OPT_SKIP_TAILSCALE" = 1 ] || \
    { command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; }
}
step_tailscale_up() {
  [ "$OPT_SKIP_TAILSCALE" = 1 ] && { STEP_DATA='{"skipped":true}'; return 0; }
  [ -n "${TS_AUTHKEY:-}" ] || die TS_AUTHKEY_INVALID "TS_AUTHKEY not provided"
  STEP_ERR_CODE=TS_AUTHKEY_INVALID
  tailscale up --auth-key="$TS_AUTHKEY" --hostname=hive || die TS_AUTHKEY_INVALID "tailscale up failed"
  STEP_ERR_CODE=""
  local ip; ip="$(tailscale ip -4 2>/dev/null | head -1)"
  [ -n "$ip" ] || die TS_DAEMON_DOWN "no tailnet IP assigned"
  RESOLVED_HOST="$ip"
  STEP_DATA="$(printf '{"tailnetIp":"%s"}' "$ip")"
}

# ---------------------------------------------------------------------------

title_configure_ufw() { echo "Configure the firewall"; }
step_configure_ufw() {
  [ "$OPT_SKIP_UFW" = 1 ] && { STEP_DATA='{"skipped":true}'; return 0; }
  STEP_ERR_CODE=UFW_FAILURE
  ufw --force default deny incoming
  ufw --force default allow outgoing
  ufw allow ssh
  [ "$OPT_SKIP_TAILSCALE" = 1 ] || ufw allow in on tailscale0
  ufw --force enable
  STEP_ERR_CODE=""
}

# ---------------------------------------------------------------------------

title_install_release() { echo "Install the Hive backend"; }
guard_install_release() {
  [ "$(readlink -f "$HIVE_OPT/current" 2>/dev/null)" = "$HIVE_OPT/releases/$HIVE_VERSION" ] || return 1
  # Dev tarballs reuse the same version string; only skip if the content is
  # identical too (checksum recorded at install time).
  if [ -n "$OPT_RELEASE_FILE" ] && [ -f "$OPT_RELEASE_FILE" ]; then
    local recorded current_sum
    recorded="$(cat "$HIVE_OPT/releases/$HIVE_VERSION/.tarball.sha256" 2>/dev/null || true)"
    current_sum="$(sha256sum "$OPT_RELEASE_FILE" | cut -d' ' -f1)"
    [ -n "$recorded" ] && [ "$recorded" = "$current_sum" ] || return 1
  fi
  return 0
}
step_install_release() {
  local rel="$HIVE_OPT/releases/$HIVE_VERSION" tarball
  install -d -o hive -g hive "$HIVE_OPT/releases" "$HIVE_OPT/shared"
  ln -sfn "$HIVE_DATA_DIR" "$HIVE_OPT/shared/data"

  if [ -n "$OPT_RELEASE_FILE" ]; then
    tarball="$OPT_RELEASE_FILE"
    [ -f "$tarball" ] || die RELEASE_DOWNLOAD_FAILED "release file not found: $tarball"
  else
    local arch_tag; case "$(uname -m)" in x86_64) arch_tag=x64;; aarch64) arch_tag=arm64;; esac
    tarball="$HIVE_VAR_DIR/hive-backend.tar.gz"
    STEP_ERR_CODE=RELEASE_DOWNLOAD_FAILED
    run_logged install_release curl -fsSL -o "$tarball" \
      "https://github.com/0xlny/hive/releases/download/v$HIVE_VERSION/hive-backend-$HIVE_VERSION-linux-$arch_tag.tar.gz"
    STEP_ERR_CODE=""
    # checksum verification would go here (RELEASE_DOWNLOAD_FAILED/CHECKSUM_MISMATCH)
  fi

  rm -rf "$rel"; install -d -o hive -g hive "$rel"
  tar -xzf "$tarball" -C "$rel"
  sha256sum "$tarball" | cut -d' ' -f1 >"$rel/.tarball.sha256"
  chown -R hive:hive "$rel"
  ln -sfn "$rel" "$HIVE_OPT/release.tmp"
  mv -Tf "$HIVE_OPT/release.tmp" "$HIVE_OPT/current"
  # Keep at most 3 generations.
  ls -1dt "$HIVE_OPT/releases"/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf
}

# ---------------------------------------------------------------------------

title_write_secrets() { echo "Write service configuration"; }
step_write_secrets() {
  install -d -m 755 /etc/hive
  local host="$OPT_HOST"
  [ -n "${RESOLVED_HOST:-}" ] && [ "$OPT_SKIP_TAILSCALE" != 1 ] && host="0.0.0.0"
  umask 077
  cat >/etc/hive/hive.env <<EOF
NODE_ENV=production
HOST=$host
PORT=$OPT_PORT
DATA_DIR=$HIVE_DATA_DIR
HIVE_AUTH_TOKEN_SHA256=${HIVE_AUTH_TOKEN_SHA256:-}
PATH=/home/hive/.local/share/mise/shims:/home/hive/.local/bin:/usr/local/bin:/usr/bin:/bin
EOF
  chmod 600 /etc/hive/hive.env
}

# ---------------------------------------------------------------------------

title_write_units() { echo "Install the systemd services"; }
step_write_units() {
  cat >/etc/systemd/system/hive.service <<EOF
[Unit]
Description=Hive backend
Wants=network-online.target
After=network-online.target tailscaled.service

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

[Install]
WantedBy=multi-user.target
EOF
  # Updater trigger: path unit watches a hive-writable flag; updater runs as root
  # in its own cgroup so a hive restart never kills an in-flight update.
  cat >/etc/systemd/system/hive-updater.path <<EOF
[Unit]
Description=Watch for Hive update requests
[Path]
PathExists=$HIVE_OPT/shared/.update-requested
Unit=hive-updater.service
[Install]
WantedBy=multi-user.target
EOF
  cat >/etc/systemd/system/hive-updater.service <<EOF
[Unit]
Description=Hive self-update
[Service]
Type=oneshot
ExecStart=/usr/lib/hive/helpers/update-hive.sh
EOF
  systemctl daemon-reload
}

# ---------------------------------------------------------------------------

title_install_helpers() { echo "Install privileged helpers"; }
step_install_helpers() {
  # Root-owned, argument-fixed helpers the backend invokes via sudo. Their mere
  # presence signals "on a provisioned server" to the backend (real-install mode).
  install -d -m 755 /usr/lib/hive/helpers

  cat >/usr/lib/hive/helpers/install-gh.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  >/etc/apt/sources.list.d/github-cli.list
DEBIAN_FRONTEND=noninteractive apt-get update -q -o DPkg::Lock::Timeout=300
DEBIAN_FRONTEND=noninteractive apt-get install -q -y -o DPkg::Lock::Timeout=300 gh
EOF

  cat >/usr/lib/hive/helpers/install-docker.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
curl -fsSL https://get.docker.com | sh
# Rootless for the hive user (docker group == host root; avoid it).
apt-get install -y -o DPkg::Lock::Timeout=300 uidmap dbus-user-session || true
loginctl enable-linger hive || true
sudo -u hive XDG_RUNTIME_DIR=/run/user/$(id -u hive) dockerd-rootless-setuptool.sh install || true
EOF

  cat >/usr/lib/hive/helpers/write-claude-token.sh <<'EOF'
#!/usr/bin/env bash
# Write CLAUDE_CODE_OAUTH_TOKEN into the service env (root-owned, 0600).
set -euo pipefail
token="${1:-}"
[ -n "$token" ] || { echo "no token" >&2; exit 2; }
install -d -m 755 /etc/hive
tmp="$(mktemp)"
grep -v '^CLAUDE_CODE_OAUTH_TOKEN=' /etc/hive/hive.env 2>/dev/null >"$tmp" || true
printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$token" >>"$tmp"
install -m 600 "$tmp" /etc/hive/hive.env
rm -f "$tmp"
systemctl restart hive || true
EOF

  cat >/usr/lib/hive/helpers/update-hive.sh <<'EOF'
#!/usr/bin/env bash
# Placeholder self-update entrypoint (Phase 6 wires the real swap + rollback).
set -euo pipefail
rm -f /opt/hive/shared/.update-requested
echo "update-hive: not yet implemented" >&2
EOF

  chmod 755 /usr/lib/hive/helpers/*.sh
  chown -R root:root /usr/lib/hive

  # Allow the hive service user to run exactly these helpers as root.
  cat >/etc/sudoers.d/hive <<'EOF'
hive ALL=(root) NOPASSWD: /usr/lib/hive/helpers/install-gh.sh, /usr/lib/hive/helpers/install-docker.sh, /usr/lib/hive/helpers/write-claude-token.sh, /usr/lib/hive/helpers/update-hive.sh
EOF
  chmod 440 /etc/sudoers.d/hive
  visudo -cf /etc/sudoers.d/hive >/dev/null || die UNKNOWN "sudoers validation failed"
}

title_enable_service() { echo "Start Hive"; }
step_enable_service() {
  STEP_ERR_CODE=SERVICE_START_FAILED
  systemctl enable hive >/dev/null 2>&1 || true
  systemctl restart hive
  STEP_ERR_CODE=""
}

# ---------------------------------------------------------------------------

title_health_check() { echo "Verify Hive is healthy"; }
step_health_check() {
  local host="$OPT_HOST" i
  for i in $(seq 1 15); do
    if curl -fsS "http://$host:$OPT_PORT/health" >/dev/null 2>&1; then
      STEP_DATA="$(printf '{"attempts":%d}' "$i")"
      return 0
    fi
    sleep 2
  done
  die HEALTH_TIMEOUT "Hive did not become healthy on $host:$OPT_PORT"
}

# ---------------------------------------------------------------------------

title_cleanup() { echo "Finish up"; }
step_cleanup() {
  rm -f "$ENV_FILE"        # rm, not shred: journaling FS gives shred no guarantee
  STEP_DATA="$(printf '{"host":"%s","port":%d}' "${RESOLVED_HOST:-$OPT_HOST}" "$OPT_PORT")"
}
