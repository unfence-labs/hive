# shellcheck shell=bash
# shellcheck disable=SC2034  # globals are shared across the bundled fragments
# Hive provision steps. Each step is `step_<id>`, with an optional `guard_<id>`
# (skip when it succeeds) and `title_<id>`. A guard that always returns 1 marks
# a step that must re-run on every invocation.
#
# Options come from parse_args in main.sh:
#   OPT_PORT OPT_INSTALL_DIR OPT_DATA_DIR OPT_ALLOWED_HOST OPT_SSH_KEY,
#   plus HIVE_VERSION and ARCH_TAG. Paths derived from them are computed by
#   resolve_paths().

# Base packages. Deliberately minimal: everything Hive itself runs lives under
# /opt/hive, so the only system packages are the ones the backend shells out to
# (git) and the ones this script needs to fetch and unpack its own payloads.
APT_BASELINE="ca-certificates curl git xz-utils iproute2"

# Node is pinned: the release tarball's native modules (node-pty, sharp) are
# compiled in CI against this major's ABI. Bumping the version means bumping
# both digests and RELEASE_NODE_MAJOR in scripts/release/build-backend-tarball.sh.
# An in-place update can change the pinned version within this major. Changing
# the major requires a planned migration or a fresh install.
# Digests are pinned rather than fetched from SHASUMS256.txt so a compromised
# mirror cannot serve a matching tarball/checksum pair over the same TLS session.
NODE_VERSION="24.18.1"
NODE_SHA256_X64="d6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0"
NODE_SHA256_ARM64="7201e3a09dc825bac57867c81913e2b8f0ef87d04cb9082af4cda82f6ff3d88c"

# GitHub CLI, installed from its official release tarball for the same reason:
# no vendor apt repository is added to the operator's machine.
GH_VERSION="2.96.0"
GH_SHA256_X64="83d5c2ccad5498f58bf6368acb1ab32588cf43ab3a4b1c301bf36328b1c8bd60"
GH_SHA256_ARM64="06f86ec7103d41993b76cd78072f43595c34aaa56506d971d9860e67140bf909"

HIVE_USER="hive"
HIVE_HOME="/home/hive"
HIVE_TOOLS_DIR="$HIVE_HOME/.local"
HIVE_ETC_DIR="/etc/hive"
HIVE_ENV_FILE="$HIVE_ETC_DIR/hive.env"
HIVE_UNIT_FILE="/etc/systemd/system/hive.service"

# Defaults for the two operator-settable locations. `/etc/hive` (configuration)
# and `/var/lib/hive` (provisioning state) stay fixed: they are small, they are
# where a Linux administrator expects to find them, and making them movable
# would mean the uninstall script could not find its own inputs.
HIVE_INSTALL_DIR_DEFAULT="/opt/hive"
HIVE_DATA_DIR_DEFAULT="$HIVE_HOME/.hive"

# Derived from the two above. Recomputed by resolve_paths() after parse_args,
# because every one of them moves when --install-dir does.
HIVE_OPT=""
HIVE_DATA_DIR=""
HIVE_RUNTIME_DIR=""
HIVE_NODE_BIN=""
HIVE_SERVICE_PATH=""
HIVE_UNINSTALL_SCRIPT=""

# Free space required on the filesystem holding each directory. The install
# tree is the runtime plus up to three retained releases; the data tree is the
# operator's repositories and worktrees, which is the one that actually grows.
HIVE_INSTALL_MIN_MB=2048
HIVE_DATA_MIN_MB=1024

resolve_paths() {
  HIVE_OPT="${OPT_INSTALL_DIR:-$HIVE_INSTALL_DIR_DEFAULT}"
  HIVE_DATA_DIR="${OPT_DATA_DIR:-$HIVE_DATA_DIR_DEFAULT}"
  HIVE_RUNTIME_DIR="$HIVE_OPT/runtime"
  HIVE_NODE_BIN="$HIVE_RUNTIME_DIR/current/bin/node"
  HIVE_UNINSTALL_SCRIPT="$HIVE_OPT/hive-uninstall.sh"
  # The service PATH puts Hive's own runtime and tools ahead of the system ones,
  # and never removes the system ones.
  HIVE_SERVICE_PATH="$HIVE_TOOLS_DIR/bin:$HIVE_RUNTIME_DIR/current/bin:/usr/local/bin:/usr/bin:/bin"
}

# Durable install identity: survives the state-dir wipe on a SCRIPT_VERSION
# bump. Only an incomplete install with this exact identity may resume.
HIVE_INSTALL_MARKER="$HIVE_ETC_DIR/.hive-install"
HIVE_INSTALL_COMPLETE_MARKER="$HIVE_ETC_DIR/.hive-install-complete"
HIVE_RESTART_REQUIRED="$HIVE_VAR_DIR/restart-required"
# The exact firewall rule this install added, if any. The uninstall script
# deletes that rule and nothing else, so a rule the operator wrote by hand —
# or one an earlier install added in a different shape — is never guessed at.
HIVE_FIREWALL_RULE_FILE="$HIVE_VAR_DIR/firewall-rule"
HIVE_PENDING_RELEASE="$HIVE_VAR_DIR/pending-release"
HIVE_ACTIVATED_RELEASE="$HIVE_VAR_DIR/activated-release"

# Digest written to hive.env; set by generate_token, consumed by write_secrets.
HIVE_AUTH_TOKEN_SHA256=""

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# Stamp the install directory as ours before creating anything inside it. The
# identity is immutable: an existing manifest is validated by probe_env and is
# never truncated or rewritten by a later step.
claim_install_dir() {
  install -d -m 755 "$HIVE_ETC_DIR"
  if [ ! -e "$HIVE_INSTALL_MARKER" ]; then
    local tmp="$HIVE_INSTALL_MARKER.tmp.$$"
    install -m 644 /dev/null "$tmp"
    printf 'schema=1\nport=%s\ninstall_dir=%s\ndata_dir=%s\n' \
      "$OPT_PORT" "$HIVE_OPT" "$HIVE_DATA_DIR" >"$tmp"
    mv -f "$tmp" "$HIVE_INSTALL_MARKER"
  fi
  install -d -m 755 "$HIVE_OPT"
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

atomic_state_marker() {
  local path="$1" value="$2" tmp="$1.tmp.$$"
  install -m 644 /dev/null "$tmp"
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

# --- Read-only inspection ---------------------------------------------------
#
# Everything below only looks. Preflight and the install steps share these so
# the two can never disagree about what "already installed" or "port free"
# means — a preflight that passed on a check the install then fails would be
# worse than no preflight at all.

# Nearest existing ancestor of a path, for questions about a directory that
# does not exist yet ("could it be created here?").
existing_ancestor() {
  local p="$1"
  while [ -n "$p" ] && [ "$p" != / ] && [ ! -d "$p" ]; do p="$(dirname "$p")"; done
  printf '%s' "${p:-/}"
}

# Free megabytes on the filesystem that would hold this path.
dir_free_mb() {
  local base; base="$(existing_ancestor "$1")"
  df -Pm "$base" 2>/dev/null | awk 'NR==2 {print $4}'
}

# True when this process can look at the server the way the installer will:
# as root. Preflight may be invoked by an unprivileged account that will
# escalate for the real run, so answering "is /opt writable?" as that account
# would report a blocker that does not exist.
can_inspect_as_root() { [ "$(id -u)" = 0 ] || sudo_nopasswd; }

dir_writable() {
  local base; base="$(existing_ancestor "$1")"
  if [ "$(id -u)" = 0 ]; then
    [ -w "$base" ]
  elif sudo_nopasswd; then
    sudo -n test -w "$base" </dev/null
  else
    [ -w "$base" ]
  fi
}

ufw_is_active() {
  command -v ufw >/dev/null 2>&1 &&
    ufw status 2>/dev/null | head -1 | grep -q 'Status: active'
}

firewalld_is_active() {
  command -v firewall-cmd >/dev/null 2>&1 &&
    firewall-cmd --state 2>/dev/null | grep -q running
}

nftables_is_active() {
  command -v nft >/dev/null 2>&1 &&
    systemctl is-active --quiet nftables 2>/dev/null
}

# Which firewall manager governs the server. Active managers win over merely
# installed ones, so an inactive ufw package cannot hide an enforcing
# firewalld or nftables service.
firewall_backend() {
  if firewalld_is_active; then printf firewalld
  elif ufw_is_active; then printf ufw
  # ufw and firewalld commonly use nftables underneath, so only treat the
  # system nftables service as the manager after both have been ruled out.
  elif nftables_is_active; then printf nftables
  elif command -v ufw >/dev/null 2>&1; then printf ufw
  elif command -v firewall-cmd >/dev/null 2>&1; then printf firewalld
  elif command -v nft >/dev/null 2>&1; then printf nftables
  else printf none
  fi
}

firewall_active() {
  case "$(firewall_backend)" in
    ufw) ufw_is_active ;;
    firewalld) firewalld_is_active ;;
    nftables) nftables_is_active ;;
    *) return 1 ;;
  esac
}

# No `grep -q`: its early exit can SIGPIPE ss, turning a found port into a
# non-zero pipeline under pipefail (a busy port read as free).
port_in_use() {
  command -v ss >/dev/null 2>&1 || return 2
  ss -ltn 2>/dev/null | grep ":${1}\b" >/dev/null
}

# Parsed manifest values. They are display-only until read_install_manifest has
# validated the complete file.
HIVE_STORED_SCHEMA=""
HIVE_STORED_PORT=""
HIVE_STORED_INSTALL_DIR=""
HIVE_STORED_DATA_DIR=""
HIVE_INSTALL_STATE=""

safe_install_path() {
  [[ "$1" =~ ^(/[A-Za-z0-9._-]+)+$ ]] && [[ "$1" != *".."* ]]
}

# Read the manifest as data, never shell. Unknown, duplicate, missing, or
# malformed fields fail closed.
read_install_manifest() {
  local content line key value
  local seen_schema=0 seen_port=0 seen_install=0 seen_data=0
  HIVE_STORED_SCHEMA=""
  HIVE_STORED_PORT=""
  HIVE_STORED_INSTALL_DIR=""
  HIVE_STORED_DATA_DIR=""
  [ -f "$HIVE_INSTALL_MARKER" ] || return 1
  if [ -r "$HIVE_INSTALL_MARKER" ]; then
    content="$({ cat "$HIVE_INSTALL_MARKER" || exit; printf '\034'; })" || return 1
  elif sudo_nopasswd; then
    content="$({ sudo -n cat "$HIVE_INSTALL_MARKER" </dev/null 2>/dev/null || exit; printf '\034'; })" || return 1
  else
    return 1
  fi
  [[ "$content" == *$'\034' ]] || return 1
  content="${content%$'\034'}"
  [[ "$content" == *$'\n' ]] || return 1
  content="${content%$'\n'}"
  [ -n "$content" ] || return 1
  while IFS= read -r line; do
    [[ "$line" == *=* ]] || return 1
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      schema)
        [ "$seen_schema" = 0 ] || return 1
        seen_schema=1; HIVE_STORED_SCHEMA="$value" ;;
      port)
        [ "$seen_port" = 0 ] || return 1
        seen_port=1; HIVE_STORED_PORT="$value" ;;
      install_dir)
        [ "$seen_install" = 0 ] || return 1
        seen_install=1; HIVE_STORED_INSTALL_DIR="$value" ;;
      data_dir)
        [ "$seen_data" = 0 ] || return 1
        seen_data=1; HIVE_STORED_DATA_DIR="$value" ;;
      *) return 1 ;;
    esac
  done <<<"$content"
  [ "$seen_schema:$seen_port:$seen_install:$seen_data" = 1:1:1:1 ] || return 1
  [ "$HIVE_STORED_SCHEMA" = 1 ] || return 1
  [[ "$HIVE_STORED_PORT" =~ ^[0-9]+$ ]] &&
    [ "$HIVE_STORED_PORT" -ge 1 ] && [ "$HIVE_STORED_PORT" -le 65535 ] || return 1
  safe_install_path "$HIVE_STORED_INSTALL_DIR" || return 1
  safe_install_path "$HIVE_STORED_DATA_DIR" || return 1
}

apply_update_identity_defaults() {
  [ "${OPT_UPDATE:-0}" = 1 ] || return 0
  read_install_manifest || return 0
  [ "$OPT_PORT_EXPLICIT" = 1 ] || OPT_PORT="$HIVE_STORED_PORT"
  [ "$OPT_INSTALL_DIR_EXPLICIT" = 1 ] || OPT_INSTALL_DIR="$HIVE_STORED_INSTALL_DIR"
  [ "$OPT_DATA_DIR_EXPLICIT" = 1 ] || OPT_DATA_DIR="$HIVE_STORED_DATA_DIR"
}

completion_marker_valid() {
  local content
  [ -f "$HIVE_INSTALL_COMPLETE_MARKER" ] || return 1
  if [ -r "$HIVE_INSTALL_COMPLETE_MARKER" ]; then
    content="$(cat "$HIVE_INSTALL_COMPLETE_MARKER")" || return 1
  elif sudo_nopasswd; then
    content="$(sudo -n cat "$HIVE_INSTALL_COMPLETE_MARKER" </dev/null 2>/dev/null)" || return 1
  else
    return 1
  fi
  [ "$content" = schema=1 ]
}

install_identity_matches_request() {
  [ "$HIVE_STORED_PORT" = "$OPT_PORT" ] &&
    [ "$HIVE_STORED_INSTALL_DIR" = "$HIVE_OPT" ] &&
    [ "$HIVE_STORED_DATA_DIR" = "$HIVE_DATA_DIR" ]
}

current_release_version() {
  local current
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  [ -n "$current" ] && cat "$current/.hive-version" 2>/dev/null || printf unknown
}

current_runtime_version() {
  local version
  [ -x "$HIVE_NODE_BIN" ] || { printf unknown; return; }
  version="$("$HIVE_NODE_BIN" -p 'process.versions.node' 2>/dev/null || true)"
  printf '%s' "${version:-unknown}"
}

update_runtime_matches_target() {
  local current
  current="$(current_runtime_version)"
  [ "${current%%.*}" = "${NODE_VERSION%%.*}" ]
}

# none | incomplete | complete | mismatch | malformed
install_identity_state() {
  if [ ! -e "$HIVE_INSTALL_MARKER" ]; then
    if [ -e "$HIVE_INSTALL_COMPLETE_MARKER" ]; then
      HIVE_INSTALL_STATE=malformed
    else
      HIVE_INSTALL_STATE=none
    fi
    return
  fi
  if ! read_install_manifest; then
    HIVE_INSTALL_STATE=malformed
    return
  fi
  if [ -e "$HIVE_INSTALL_COMPLETE_MARKER" ]; then
    if completion_marker_valid; then
      HIVE_INSTALL_STATE=complete
    else
      HIVE_INSTALL_STATE=malformed
    fi
  elif [ "$HIVE_STORED_PORT" = "$OPT_PORT" ] &&
       [ "$HIVE_STORED_INSTALL_DIR" = "$HIVE_OPT" ] &&
       [ "$HIVE_STORED_DATA_DIR" = "$HIVE_DATA_DIR" ]; then
    HIVE_INSTALL_STATE=incomplete
  else
    HIVE_INSTALL_STATE=mismatch
  fi
}

install_identity_data() {
  printf '{"stored":{"port":"%s","installDir":"%s","dataDir":"%s"},"requested":{"port":"%s","installDir":"%s","dataDir":"%s"}}' \
    "$(json_escape "${HIVE_STORED_PORT:-unknown}")" \
    "$(json_escape "${HIVE_STORED_INSTALL_DIR:-unknown}")" \
    "$(json_escape "${HIVE_STORED_DATA_DIR:-unknown}")" \
    "$(json_escape "$OPT_PORT")" "$(json_escape "$HIVE_OPT")" "$(json_escape "$HIVE_DATA_DIR")"
}

install_identity_detail() {
  printf 'stored port=%s install_dir=%s data_dir=%s; requested port=%s install_dir=%s data_dir=%s' \
    "${HIVE_STORED_PORT:-unknown}" "${HIVE_STORED_INSTALL_DIR:-unknown}" \
    "${HIVE_STORED_DATA_DIR:-unknown}" "$OPT_PORT" "$HIVE_OPT" "$HIVE_DATA_DIR"
}

HIVE_SERVICE_PORT=""

read_hive_service_port() {
  local content
  HIVE_SERVICE_PORT=""
  if [ -r "$HIVE_ENV_FILE" ]; then
    content="$(cat "$HIVE_ENV_FILE")" || return 1
  elif sudo_nopasswd; then
    content="$(sudo -n cat "$HIVE_ENV_FILE" </dev/null 2>/dev/null)" || return 1
  else
    return 1
  fi
  HIVE_SERVICE_PORT="$(sed -n 's/^PORT=//p' <<<"$content")"
  [ -n "$HIVE_SERVICE_PORT" ]
}

# Strict ownership proof used by the root install path: exact incomplete
# identity, active unit, and the service's persisted configuration all name
# the requested port.
hive_service_owns_port() {
  install_identity_state
  { [ "$HIVE_INSTALL_STATE" = incomplete ] ||
    { [ "${OPT_UPDATE:-0}" = 1 ] && [ "$HIVE_INSTALL_STATE" = complete ]; }; } &&
    install_identity_matches_request &&
    systemctl is-active --quiet hive 2>/dev/null &&
    read_hive_service_port &&
    [ "$HIVE_SERVICE_PORT" = "$OPT_PORT" ]
}

# Password-requiring preflight may see that Hive is active while remaining
# unable to read hive.env before elevation. It reports ownership as unknown;
# the root install still proves the configured port before making any change.
hive_service_port_unverifiable() {
  install_identity_state
  { [ "$HIVE_INSTALL_STATE" = incomplete ] ||
    { [ "${OPT_UPDATE:-0}" = 1 ] && [ "$HIVE_INSTALL_STATE" = complete ]; }; } &&
    install_identity_matches_request &&
    systemctl is-active --quiet hive 2>/dev/null &&
    ! can_inspect_as_root
}

foreign_install() {
  install_identity_state
  [ "$HIVE_INSTALL_STATE" = none ] &&
    { [ -e "$HIVE_UNIT_FILE" ] || [ -d "$HIVE_OPT" ]; }
}

sudo_nopasswd() {
  [ "$(id -u)" = 0 ] && return 0
  command -v sudo >/dev/null 2>&1 || return 1
  sudo -n true >/dev/null 2>&1 </dev/null
}

# The key blob identifies a key; the trailing comment does not. Comparing on
# the blob keeps an exact incomplete resume from adding a duplicate entry.
ssh_key_blob() { awk '{print $1" "$2}' <<<"$1"; }

ssh_key_valid() {
  [[ "$1" =~ ^(ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)[[:space:]]+[A-Za-z0-9+/]+=*([[:space:]].*)?$ ]]
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
}

# ---------------------------------------------------------------------------

title_probe_env() { echo "Check for conflicts"; }

# Both directories must be creatable and have room. Checked here rather than at
# first write so a wrong --data-dir fails in seconds, not after a runtime and a
# release have already been downloaded.
assert_dir_usable() {
  # assert_dir_usable <label> <path> <min-mb>
  local label="$1" path="$2" min="$3" free
  dir_writable "$path" || die DIRECTORY_UNUSABLE \
    "$label $path cannot be created: $(existing_ancestor "$path") is not writable"
  free="$(dir_free_mb "$path")"
  [ -n "$free" ] || return 0                    # df said nothing usable; do not invent a failure
  [ "$free" -ge "$min" ] || die INSUFFICIENT_DISK_SPACE \
    "$label $path has ${free}MB free on $(existing_ancestor "$path"), and Hive needs ${min}MB"
}

# Always re-runs. Every finding here is about the server as it is right now:
# the port may have been taken since the last run, a filesystem may have filled
# up. A cached "conflict-free" answer from a previous run is worth nothing, and
# the resume/fresh distinction has to reach the stream on every run.
guard_probe_env() { return 1; }

step_probe_env() {
  local state resume=false update=false port_rc=0 installed_runtime
  [ "${OPT_UPDATE:-0}" = 1 ] && update=true
  install_identity_state
  state="$HIVE_INSTALL_STATE"
  case "$state" in
    none)
      if foreign_install; then
        die EXISTING_INSTALL "$HIVE_OPT or $HIVE_UNIT_FILE already exists but was not created by Hive"
      elif [ "${OPT_UPDATE:-0}" = 1 ]; then
        die UPDATE_NOT_INSTALLED \
          "Hive is not installed on this server; run the installer without --update"
      fi ;;
    incomplete)
      if [ "${OPT_UPDATE:-0}" = 1 ]; then
        die INSTALL_IDENTITY_MISMATCH \
          "the existing Hive installation is incomplete; resume it without --update"
      fi
      resume=true ;;
    complete)
      if [ "${OPT_UPDATE:-0}" = 1 ]; then
        install_identity_matches_request || die INSTALL_IDENTITY_MISMATCH \
          "Hive can update only with its existing identity: $(install_identity_detail)"
        installed_runtime="$(current_runtime_version)"
        [ "${installed_runtime%%.*}" = "${NODE_VERSION%%.*}" ] || die UPDATE_RUNTIME_MISMATCH \
          "backend-only update requires Node major ${NODE_VERSION%%.*}, but this installation uses $installed_runtime"
        emit_log probe_env \
          "Updating Hive from $(current_release_version) to ${HIVE_VERSION:-unknown}; the service will restart."
      else
        die ALREADY_INSTALLED \
          "Hive is already installed; re-run this release with --update ($(install_identity_detail))"
      fi ;;
    mismatch)
      die INSTALL_IDENTITY_MISMATCH \
        "an incomplete Hive install can resume only with its original options: $(install_identity_detail)" ;;
    malformed)
      die INSTALL_IDENTITY_MISMATCH \
        "the Hive install identity is missing or malformed and cannot be resumed safely: $(install_identity_detail)" ;;
  esac

  assert_dir_usable "the install directory" "$HIVE_OPT" "$HIVE_INSTALL_MIN_MB"
  assert_dir_usable "the data directory" "$HIVE_DATA_DIR" "$HIVE_DATA_MIN_MB"

  if [ -n "$OPT_SSH_KEY" ] && ! ssh_key_valid "$OPT_SSH_KEY"; then
    die SSH_KEY_INVALID \
      "the value passed for the $HIVE_USER account's public key is not an OpenSSH public key"
  fi

  port_in_use "$OPT_PORT" || port_rc=$?
  case "$port_rc" in
    0)
      hive_service_owns_port || die PORT_IN_USE \
        "port ${OPT_PORT} is already in use and is not owned by the matching active Hive service" ;;
    2) emit_log probe_env "ss unavailable; skipping the port ${OPT_PORT} availability check" ;;
  esac

  STEP_DATA="$(printf '{"resume":%s,"update":%s}' "$resume" "$update")"
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

# The account is what editor and terminal sessions connect as, so a resumed run
# has to name it exactly as a fresh one does. Without this the caller would have
# to assume the name, and an assumption cannot follow a configurable account.
skipdata_create_user() {
  printf '{"user":"%s"}' "$HIVE_USER"
}

step_create_user() {
  id "$HIVE_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$HIVE_USER"
  # A data directory outside the service account's home may need its parents
  # created. Those are left with the system's default ownership and mode: only
  # the data directory itself becomes hive-owned and private.
  mkdir -p "$(dirname "$HIVE_DATA_DIR")"
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 700 "$HIVE_DATA_DIR"
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 755 "$HIVE_TOOLS_DIR" "$HIVE_TOOLS_DIR/bin"
  STEP_DATA="$(printf '{"user":"%s"}' "$HIVE_USER")"
}

# ---------------------------------------------------------------------------

title_authorize_ssh_key() { echo "Authorize SSH access to the hive account"; }

# The service account owns every repository and worktree. An editor or terminal
# session that connects as root instead silently takes ownership of every file
# it saves, after which the agent — running as hive — can no longer write them.
# Authorizing the operator's own key on the hive account is what keeps those
# sessions on the right user.
HIVE_SSH_DIR="$HIVE_HOME/.ssh"
HIVE_AUTHORIZED_KEYS="$HIVE_SSH_DIR/authorized_keys"

authorized_key_present() {
  [ -f "$HIVE_AUTHORIZED_KEYS" ] || return 1
  local blob; blob="$(ssh_key_blob "$1")"
  # Match on type+blob, never on the whole line: the trailing comment is not
  # part of the key's identity, so an incomplete resume with a different comment must not
  # append a second copy of the same key.
  awk -v want="$blob" '{ if ($1" "$2 == want) found=1 } END { exit found ? 0 : 1 }' \
    "$HIVE_AUTHORIZED_KEYS"
}

guard_authorize_ssh_key() {
  [ -z "$OPT_SSH_KEY" ] && return 0            # nothing asked for
  authorized_key_present "$OPT_SSH_KEY"
}

# probe_env already died on an invalid key, so the key that reaches this step
# is known to be well-formed.
step_authorize_ssh_key() {
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 700 "$HIVE_SSH_DIR"
  # Append. Keys the operator added by hand are never read, rewritten or
  # removed — the file is only ever grown by this step.
  [ -f "$HIVE_AUTHORIZED_KEYS" ] || install -o "$HIVE_USER" -g "$HIVE_USER" -m 600 \
    /dev/null "$HIVE_AUTHORIZED_KEYS"
  # A file not ending in a newline would otherwise splice our key onto the
  # operator's last one, silently destroying both.
  if [ -s "$HIVE_AUTHORIZED_KEYS" ] && [ -n "$(tail -c1 "$HIVE_AUTHORIZED_KEYS")" ]; then
    printf '\n' >>"$HIVE_AUTHORIZED_KEYS"
  fi
  printf '%s\n' "$OPT_SSH_KEY" >>"$HIVE_AUTHORIZED_KEYS"
  chown "$HIVE_USER:$HIVE_USER" "$HIVE_AUTHORIZED_KEYS"
  chmod 600 "$HIVE_AUTHORIZED_KEYS"
}

# ---------------------------------------------------------------------------

title_install_node() { echo "Install Hive's private Node.js runtime"; }

# The runtime lives inside Hive's install directory. The system Node — if the
# server has one at all — is never read, replaced, or upgraded, and no vendor
# package repository is added to the machine.
guard_install_node() {
  [ "$(current_runtime_version)" = "$NODE_VERSION" ]
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
  # This is the first step to create the install directory, so it is the one
  # that has to claim it.
  claim_install_dir
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
}

# ---------------------------------------------------------------------------

title_install_agent_browser() { echo "Install the browser automation tool"; }

# The agent-browser CLI plus the Chrome build it drives. Its npm postinstall
# fetches a native binary from the tool's GitHub releases and tolerates a
# failed download, so the package being present proves nothing — the guard and
# the post-install verification both ask the binary itself.
guard_install_agent_browser() {
  # Chrome for Testing publishes no linux-arm64 build, so the tool cannot
  # install a browser there. The backend treats agent-browser as optional:
  # an arm64 server provisions without browser automation rather than failing.
  [ "$ARCH_TAG" = x64 ] || return 0
  [ -x "$HIVE_TOOLS_DIR/bin/agent-browser" ] || return 1
  as_hive agent-browser --version >/dev/null 2>&1 || return 1
  compgen -G "$HIVE_HOME/.agent-browser/browsers/chrome-*/chrome" >/dev/null 2>&1 || return 1
  # The step's own verification, repeated: a binary and a Chrome on disk do
  # not prove the system libraries arrived or that the state directory is the
  # service account's. Opening a page is the one check that cannot lie, and it
  # is what keeps a Retry from skipping past a half-repaired install. The
  # sandbox flag matches the one write_secrets puts in the service
  # environment: without it Chrome cannot start under the hive unit at all.
  as_hive env AGENT_BROWSER_ARGS=--no-sandbox agent-browser open about:blank \
    >/dev/null 2>&1 || return 1
  as_hive agent-browser close >/dev/null 2>&1 || true
}
step_install_agent_browser() {
  local shim
  STEP_ERR_CODE=BROWSER_INSTALL_FAILED
  run_logged install_agent_browser as_hive npm install -g --prefix "$HIVE_TOOLS_DIR" \
    --no-audit --no-fund agent-browser

  # The state directory is rebuilt root-side before the tool writes into it as
  # root: an existing tree is hive-writable, and a symlink planted inside it
  # would redirect root's writes. The step only runs when the install is
  # absent or broken, so the discarded download is a broken one.
  rm -rf "$HIVE_HOME/.agent-browser"
  install -d -o "$HIVE_USER" -g "$HIVE_USER" "$HIVE_HOME/.agent-browser"

  # `install --with-deps` needs root for Chrome's system libraries, but the
  # browser download lands under $HOME — so it runs as root with the service
  # account's HOME, and the state directory is handed over afterwards. Not
  # `as_hive`: the service account cannot install apt packages. Two details:
  # the tool invokes `sudo apt-get` even when it is already root and a minimal
  # Debian has no sudo, so it gets a pass-through shim; and the PATH is
  # root-owned directories only — never $HIVE_TOOLS_DIR/bin, which the service
  # account can write to. That root runs the hive-installed agent-browser
  # binary at all is the residual trust this step accepts; it is why the
  # invocation is by absolute path and nothing else resolves through hive's
  # prefix.
  shim="$HIVE_VAR_DIR/sudo-shim"
  install -d -m 700 "$shim"
  printf '#!/bin/sh\nexec "$@"\n' >"$shim/sudo"
  chmod 700 "$shim/sudo"
  run_logged install_agent_browser env HOME="$HIVE_HOME" \
    PATH="$shim:$HIVE_RUNTIME_DIR/current/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
    DEBIAN_FRONTEND=noninteractive \
    "$HIVE_TOOLS_DIR/bin/agent-browser" install --with-deps
  rm -rf "$shim"
  chown -R "$HIVE_USER:$HIVE_USER" "$HIVE_HOME/.agent-browser"

  as_hive agent-browser --version >/dev/null 2>&1 || die BROWSER_INSTALL_FAILED \
    "'agent-browser' is not runnable as the $HIVE_USER service account after installation"
  # The installer treats a failed dependency install as a warning, so the only
  # proof of a working browser is opening a page as the service account.
  run_logged install_agent_browser as_hive env AGENT_BROWSER_ARGS=--no-sandbox \
    agent-browser open about:blank || die BROWSER_INSTALL_FAILED \
    "the installed browser could not open a page as the $HIVE_USER service account"
  as_hive agent-browser close >/dev/null 2>&1 || true
  STEP_ERR_CODE=""
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
  # build-backend-tarball.sh always writes hive.nodeAbi; a tarball without it
  # is not a Hive release.
  [ -n "$declared" ] || die RELEASE_DOWNLOAD_FAILED \
    "the release manifest declares no Node ABI"
  runtime="$("$HIVE_NODE_BIN" -p 'process.versions.modules')"
  [ "$declared" = "$runtime" ] || die RELEASE_DOWNLOAD_FAILED \
    "release was built for Node ABI $declared but the pinned runtime is ABI $runtime"
}

guard_install_release() {
  local current recorded
  current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
  [ -n "$current" ] || return 1
  [ "$(cat "$current/.hive-version" 2>/dev/null || true)" = "$HIVE_VERSION" ] || return 1
  # A sideloaded dev release keeps its version across rebuilds, so the version
  # marker alone would skip a genuinely new tarball; the checksum decides.
  if [ -n "$OPT_RELEASE_FILE" ] && [ -f "$OPT_RELEASE_FILE" ]; then
    recorded="$(cat "$current/.tarball.sha256" 2>/dev/null || true)"
    { [ -n "$recorded" ] && [ "$recorded" = "$(sha256_of "$OPT_RELEASE_FILE")" ]; } || return 1
  fi
  verify_release_dir "$current"
}
step_install_release() {
  local tarball checksum base_url asset_url expected rel staging current
  claim_install_dir
  install -d -o "$HIVE_USER" -g "$HIVE_USER" -m 755 "$HIVE_OPT/releases" "$HIVE_OPT/shared"
  ln -sfn "$HIVE_DATA_DIR" "$HIVE_OPT/shared/data"

  if [ -n "$OPT_RELEASE_FILE" ]; then
    # A locally built tarball uploaded by a debug sidecar. parse_args already
    # refused this option for stable script versions; everything after the
    # checksum is the same path the downloaded release takes.
    [ -f "$OPT_RELEASE_FILE" ] || die RELEASE_DOWNLOAD_FAILED \
      "release file not found: $OPT_RELEASE_FILE"
    tarball="$OPT_RELEASE_FILE"
    checksum="$(sha256_of "$tarball")"
  else
    [ "$HIVE_VERSION" != "0.0.0-dev" ] || die RELEASE_DOWNLOAD_FAILED \
      "a dev build has no published release: run 'bash scripts/release/build-backend-tarball.sh 0.0.0-dev <x64|arm64>' in the repo — the debug app uploads it from dist-release/ automatically (or set HIVE_DEV_RELEASE_TARBALL to a tarball path) — then retry"
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
}

# ---------------------------------------------------------------------------

title_generate_token() { echo "Generate the access token"; }

# Always re-runs during an incomplete resume: the plaintext is reported exactly
# once on its run's stream and cannot be recovered from an earlier attempt.
guard_generate_token() { [ "${OPT_UPDATE:-0}" = 1 ]; }

# /dev/urandom is guaranteed on the pinned Ubuntu/Debian targets, and RUN_ID
# already trusts it bare.
random_hex_32() {
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
  # AGENT_BROWSER_ARGS: Chromium's sandbox cannot work under the hive unit —
  # NoNewPrivileges blocks the setuid helper and Ubuntu 24.04 restricts
  # unprivileged user namespaces — so the browser the agents drive through
  # `agent-browser` must run without it. Deliberately not HIVE_-prefixed: the
  # backend strips HIVE_* from agent environments (backend/src/utils/env.ts)
  # and this variable must reach them.
  cat <<EOF
NODE_ENV=production
HOST=0.0.0.0
PORT=$OPT_PORT
DATA_DIR=$HIVE_DATA_DIR
HIVE_AUTH_TOKEN_SHA256=$HIVE_AUTH_TOKEN_SHA256
HIVE_AUTOMATION_TIMEOUT_SEC=1800
HIVE_UPDATE_METHOD=provisioner
HOME=$HIVE_HOME
PATH=$HIVE_SERVICE_PATH
AGENT_BROWSER_ARGS=--no-sandbox
EOF
  [ -z "${OPT_ALLOWED_HOST:-}" ] || echo "HIVE_ALLOWED_HOSTS=$OPT_ALLOWED_HOST"
  # A prerelease install is a developer's test server. The webview of a debug
  # desktop app is served by Vite, so its Origin is the dev server, which the
  # production CORS/WebSocket allowlists reject. Stable installs never get this.
  case "${HIVE_VERSION:-}" in
    *-*) echo "HIVE_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173" ;;
  esac
}

# Installs and incomplete resumes rewrite the file with their newly generated
# digest. Updates preserve the complete file, including operator settings.
guard_write_secrets() { [ "${OPT_UPDATE:-0}" = 1 ]; }

step_write_secrets() {
  local tmp written
  : >"$HIVE_RESTART_REQUIRED"
  claim_install_dir
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
ReadWritePaths=$HIVE_HOME $HIVE_OPT/shared $HIVE_DATA_DIR
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

title_firewall_rule() { echo "Check the firewall"; }

# This step never enables a firewall, never changes a default policy, and never
# adds a rule for anything but Hive's own port. The reference implementation set
# `default deny incoming`, allowed port 22, and force-enabled ufw; on a server
# where ufw was installed but inactive that severs every service without an
# explicit rule, and on a server whose SSH listens anywhere but 22 it severs the
# session running the install, with no way back in. Hive only opens its own port
# when ufw is already enforcing one.
#
# Only ufw is modified. An active firewalld or nftables service blocks the
# install because their runtime/permanent and zone semantics cannot be guessed
# safely, and succeeding with a closed port would leave Hive unusable.
# Every rule this install added, one per line, appended and never rewritten.
# Exact resumes reassert the same rule without duplicating it.
record_firewall_rule() {
  local spec="$1"
  [ -f "$HIVE_FIREWALL_RULE_FILE" ] || : >"$HIVE_FIREWALL_RULE_FILE"
  grep -qxF "$spec" "$HIVE_FIREWALL_RULE_FILE" || \
    printf '%s\n' "$spec" >>"$HIVE_FIREWALL_RULE_FILE"
}

# Always re-runs: the rule is cheap to re-assert, ufw itself is idempotent, and
# the reported state must describe the firewall as it is now, not as it was on
# the run that first recorded it.
guard_firewall_rule() { return 1; }

step_firewall_rule() {
  local backend spec
  backend="$(firewall_backend)"

  if [ "$backend" = none ] || ! firewall_active; then
    emit_log firewall_rule \
      "No active firewall detected (${backend}); leaving the host's network policy untouched."
    emit_log firewall_rule \
      "Hive listens on port $OPT_PORT. Restricting who can reach it is the operator's decision."
    # Any rule recorded by an earlier run stays recorded: `ufw disable` keeps
    # the rules, so the uninstaller still has to be able to take ours back out.
    STEP_DATA="$(printf '{"backend":"%s","active":false,"ruleApplied":false,"reason":"firewall-inactive","port":%s}' \
      "$backend" "$OPT_PORT")"
    return 0
  fi

  if [ "$backend" != ufw ]; then
    die FIREWALL_RULE_FAILED \
      "$backend is active, and Hive cannot configure it automatically"
  fi

  spec="allow $OPT_PORT/tcp"
  STEP_ERR_CODE=FIREWALL_RULE_FAILED
  # Exactly one rule. No `ufw enable`, no `ufw default`, no blanket SSH rule.
  # shellcheck disable=SC2086  # the spec is built above from validated values
  run_logged firewall_rule ufw $spec
  STEP_ERR_CODE=""
  record_firewall_rule "$spec"
  emit_log firewall_rule "ufw was already active; added the single rule 'ufw $spec'."
  STEP_DATA="$(printf '{"backend":"ufw","active":true,"ruleApplied":true,"rule":"ufw %s","port":%s}' \
    "$(json_escape "$spec")" "$OPT_PORT")"
}

# ---------------------------------------------------------------------------

title_write_uninstall() { echo "Write the uninstall script"; }

# Generated at install time carrying the paths this run actually used, so it
# removes what was really installed even when the operator chose non-default
# locations. This is the k3s convention, and the reason for it is that a script
# shipped with fixed paths silently leaves a non-default install behind.
hive_uninstall_script() {
  cat <<EOF
#!/usr/bin/env bash
# Hive uninstaller — generated by provision.sh $SCRIPT_VERSION for this server.
#
#   $HIVE_UNINSTALL_SCRIPT           remove Hive, keep the data
#   $HIVE_UNINSTALL_SCRIPT --purge   remove Hive and the data as well
#
# Removes: the systemd unit, the install directory (including Hive's private
# Node runtime), the configuration, the provisioning state, the service
# account, and the one firewall rule this install added.
#
# Never removes: system packages, package repositories, or your data. Your
# repositories, worktrees and sessions live in the data directory and survive
# unless you pass --purge.
#
# The body is one function called on the last line so the whole script is
# parsed before it starts deleting — including deleting itself.
set -Eeuo pipefail

__hive_uninstall() {
  local purge=0
  case "\${1:-}" in
    --purge) purge=1 ;;
    "") ;;
    *) echo "usage: \$0 [--purge]" >&2; exit 2 ;;
  esac
  [ "\$(id -u)" = 0 ] || { echo "the uninstaller must run as root" >&2; exit 1; }

  echo "Stopping and removing the service"
  systemctl stop hive >/dev/null 2>&1 || true
  systemctl disable hive >/dev/null 2>&1 || true
  rm -f "$HIVE_UNIT_FILE"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl reset-failed hive >/dev/null 2>&1 || true

  # Only the rules this install recorded adding. A rule the operator wrote by
  # hand is never guessed at, and the firewall is never enabled or disabled.
  if [ -s "$HIVE_FIREWALL_RULE_FILE" ] && command -v ufw >/dev/null 2>&1; then
    local spec
    while IFS= read -r spec; do
      [ -n "\$spec" ] || continue
      echo "Removing the firewall rule this install added: ufw \$spec"
      # shellcheck disable=SC2086
      ufw delete \$spec >/dev/null 2>&1 || true
    done <"$HIVE_FIREWALL_RULE_FILE"
  fi

  echo "Removing the install directory $HIVE_OPT"
  rm -rf "$HIVE_OPT"
  echo "Removing the configuration $HIVE_ETC_DIR"
  rm -rf "$HIVE_ETC_DIR"
  echo "Removing the provisioning state $HIVE_VAR_DIR"
  rm -rf "$HIVE_VAR_DIR"

  if [ "\$purge" = 1 ]; then
    echo "Removing the data directory $HIVE_DATA_DIR"
    rm -rf "$HIVE_DATA_DIR"
    userdel -r "$HIVE_USER" >/dev/null 2>&1 || userdel "$HIVE_USER" >/dev/null 2>&1 || true
    rm -rf "$HIVE_HOME"
    echo "Hive and its data were removed."
  else
    # userdel without -r: the home directory holds the data directory by
    # default, and removing the account must not remove the operator's work.
    userdel "$HIVE_USER" >/dev/null 2>&1 || true
    echo "Hive was removed. Your data is still at $HIVE_DATA_DIR."
    echo "Re-run with --purge to remove it too."
  fi
  echo "System packages and package repositories were left alone."
}

__hive_uninstall "\$@"
EOF
}

guard_write_uninstall() {
  [ -f "$HIVE_UNINSTALL_SCRIPT" ] && cmp -s <(hive_uninstall_script) "$HIVE_UNINSTALL_SCRIPT"
}

step_write_uninstall() {
  local tmp
  claim_install_dir
  tmp="$(mktemp)"
  hive_uninstall_script >"$tmp"
  install -o root -g root -m 750 "$tmp" "$HIVE_UNINSTALL_SCRIPT"
  rm -f "$tmp"
  bash -n "$HIVE_UNINSTALL_SCRIPT" || die UNKNOWN \
    "the generated uninstall script is not valid bash"
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
  local previous
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
  for _ in $(seq 1 10); do
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
  local attempts="${HIVE_HEALTH_ATTEMPTS:-30}" current pending
  [[ "$attempts" =~ ^[1-9][0-9]*$ ]] || attempts=30
  for _ in $(seq 1 "$attempts"); do
    if health_ok; then
      current="$(readlink -f "$HIVE_OPT/current" 2>/dev/null || true)"
      pending="$(cat "$HIVE_PENDING_RELEASE" 2>/dev/null || true)"
      if [ -n "$pending" ] && [ "$pending" != "$current" ]; then
        die HEALTH_TIMEOUT "release activation intent does not match the current release"
      fi
      atomic_marker "$HIVE_ACTIVATED_RELEASE" "$current"
      rm -f "$HIVE_OPT/previous" "$HIVE_PENDING_RELEASE"
      prune_releases
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
}

# ---------------------------------------------------------------------------

title_complete_install() { echo "Complete the install"; }
guard_complete_install() { [ -e "$HIVE_INSTALL_COMPLETE_MARKER" ]; }
step_complete_install() {
  atomic_state_marker "$HIVE_INSTALL_COMPLETE_MARKER" "schema=1"
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
#
# Reports, never decides, and never writes: no directory is created, no package
# is touched, no file on this server changes. Every finding is a record on the
# stream and the run always exits 0, because "this server is not ready" is an
# answer, not a failure of the check. The checks reuse the same helpers the
# install steps use, so preflight cannot pass something the install then trips
# over.
#
# Each check names the error code the install would fail with, so a client can
# render the same hint from shared/setup-errors.ts either way.

preflight_os() {
  local id
  if [ ! -r /etc/os-release ]; then
    emit_check os fail "no /etc/os-release: Hive needs Ubuntu 22.04/24.04 or Debian 12/13" \
      '' UNSUPPORTED_OS
    return 0
  fi
  # shellcheck disable=SC1091
  . /etc/os-release
  id="${ID:-?} ${VERSION_ID:-?}"
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:22.04|ubuntu:24.04|debian:12|debian:13)
      emit_check os ok "$id is supported" \
        "$(printf '{"os":"%s","versionId":"%s"}' "${ID}" "${VERSION_ID}")" ;;
    *)
      emit_check os fail "$id is not supported: Hive needs Ubuntu 22.04/24.04 or Debian 12/13" \
        "$(printf '{"os":"%s","versionId":"%s"}' "${ID:-}" "${VERSION_ID:-}")" UNSUPPORTED_OS ;;
  esac
  if [ -d /run/systemd/system ]; then
    emit_check systemd ok "systemd is running"
  else
    emit_check systemd fail "systemd is not running: Hive installs itself as a systemd service" \
      '' UNSUPPORTED_OS
  fi
}

preflight_arch() {
  if [ -n "$ARCH_TAG" ]; then
    emit_check arch ok "$(uname -m) is supported" "$(printf '{"arch":"%s"}' "$ARCH_TAG")"
  else
    emit_check arch fail "$(uname -m) is not supported: Hive needs x86-64 or arm64" \
      '' UNSUPPORTED_ARCH
  fi
}

preflight_privilege() {
  if [ "$(id -u)" = 0 ]; then
    emit_check privilege ok "running as root" '{"root":true,"sudoNoPassword":true}'
  elif sudo_nopasswd; then
    emit_check privilege ok "sudo works without a password" '{"root":false,"sudoNoPassword":true}'
  else
    # Not a blocker: the installer can still run if the caller supplies a
    # password. It is reported so a client knows it has to ask for one.
    emit_check privilege warn \
      "sudo needs a password on this account; the installer will have to be given one" \
      '{"root":false,"sudoNoPassword":false}'
  fi
}

preflight_existing_install() {
  local state
  install_identity_state
  state="$HIVE_INSTALL_STATE"
  case "$state" in
    none)
      if foreign_install; then
        emit_check existing_install fail \
          "$HIVE_OPT or $HIVE_UNIT_FILE already exists but was not created by Hive" \
          "$(printf '{"installed":false,"resume":false,"installDir":"%s"}' "$(json_escape "$HIVE_OPT")")" \
          EXISTING_INSTALL
      elif [ "${OPT_UPDATE:-0}" = 1 ]; then
        emit_check existing_install fail \
          "Hive is not installed on this server; there is nothing to update" \
          "$(printf '{"installed":false,"resume":false,"update":true,"installDir":"%s"}' "$(json_escape "$HIVE_OPT")")" \
          UPDATE_NOT_INSTALLED
      else
        emit_check existing_install ok "no existing install; this run would be a fresh install" \
          "$(printf '{"installed":false,"resume":false,"installDir":"%s"}' "$(json_escape "$HIVE_OPT")")"
      fi ;;
    incomplete)
      if [ "${OPT_UPDATE:-0}" = 1 ]; then
        emit_check existing_install fail \
          "the existing Hive installation is incomplete; resume it without --update" \
          "$(install_identity_data)" INSTALL_IDENTITY_MISMATCH
      else
        emit_check existing_install ok "an incomplete Hive install with these exact options can resume" \
          "$(install_identity_data)"
      fi ;;
    complete)
      if [ "${OPT_UPDATE:-0}" = 1 ]; then
        if install_identity_matches_request; then
          if update_runtime_matches_target; then
            emit_check existing_install ok \
              "Hive $(current_release_version) can update to ${HIVE_VERSION:-unknown} with its existing identity" \
              "$(install_identity_data)"
          else
            emit_check existing_install fail \
              "backend-only update requires Node major ${NODE_VERSION%%.*}, but this installation uses $(current_runtime_version)" \
              "$(install_identity_data)" UPDATE_RUNTIME_MISMATCH
          fi
        else
          emit_check existing_install fail \
            "Hive can update only with its existing identity: $(install_identity_detail)" \
            "$(install_identity_data)" INSTALL_IDENTITY_MISMATCH
        fi
      else
        emit_check existing_install fail \
          "Hive is already installed; re-run this release with --update" \
          "$(install_identity_data)" ALREADY_INSTALLED
      fi ;;
    mismatch)
      emit_check existing_install fail \
        "the incomplete Hive install has different options and cannot be resumed: $(install_identity_detail)" \
        "$(install_identity_data)" INSTALL_IDENTITY_MISMATCH ;;
    malformed)
      emit_check existing_install fail \
        "the Hive install identity is missing or malformed and cannot be resumed safely" \
        "$(install_identity_data)" INSTALL_IDENTITY_MISMATCH ;;
  esac
}

preflight_port() {
  local rc=0
  port_in_use "$OPT_PORT" || rc=$?
  case "$rc" in
    0)
      if hive_service_owns_port; then
        emit_check port ok "port $OPT_PORT belongs to the matching incomplete Hive install" \
          "$(printf '{"port":%s,"free":true,"heldByHive":true}' "$OPT_PORT")"
      elif hive_service_port_unverifiable; then
        emit_check port warn \
          "port $OPT_PORT is busy, but Hive service ownership cannot be checked until installation gains root" \
          "$(printf '{"port":%s,"free":false,"heldByHive":null}' "$OPT_PORT")"
      else
        emit_check port fail "port $OPT_PORT is already in use by another service" \
          "$(printf '{"port":%s,"free":false,"heldByHive":false}' "$OPT_PORT")" PORT_IN_USE
      fi ;;
    2) emit_check port warn "ss is not installed, so port $OPT_PORT could not be checked" \
         "$(printf '{"port":%s}' "$OPT_PORT")" ;;
    *) emit_check port ok "port $OPT_PORT is free" \
         "$(printf '{"port":%s,"free":true}' "$OPT_PORT")" ;;
  esac
}

preflight_dir() {
  # preflight_dir <check-id> <label> <path> <min-mb>
  local id="$1" label="$2" path="$3" min="$4" base free data
  base="$(existing_ancestor "$path")"
  free="$(dir_free_mb "$path")"
  data="$(printf '{"path":"%s","parent":"%s","exists":%s,"freeMb":%s,"requiredMb":%d}' \
    "$path" "$base" "$([ -d "$path" ] && echo true || echo false)" "${free:-null}" "$min")"
  if ! dir_writable "$path"; then
    # Unverifiable is not the same as broken: an unprivileged caller that has
    # to type a sudo password cannot answer this question, and reporting a
    # blocker it cannot see would be worse than reporting that it cannot see.
    if ! can_inspect_as_root; then
      emit_check "$id" warn \
        "$label $path could not be checked: $base is not writable by $(id -un) and this run cannot escalate" \
        "$data"
      return 0
    fi
    emit_check "$id" fail "$label $path cannot be created: $base is not writable" \
      "$data" DIRECTORY_UNUSABLE
  elif [ -n "$free" ] && [ "$free" -lt "$min" ]; then
    emit_check "$id" fail "$label $path has ${free}MB free on $base and Hive needs ${min}MB" \
      "$data" INSUFFICIENT_DISK_SPACE
  else
    emit_check "$id" ok "$label $path is writable with ${free:-unknown}MB free on $base" "$data"
  fi
}

preflight_firewall() {
  local backend active
  backend="$(firewall_backend)"
  if [ "$backend" != none ] && [ "$(id -u)" != 0 ] && ! sudo_nopasswd; then
    emit_check firewall warn \
      "$backend is installed but its state cannot be read without root" \
      "$(printf '{"backend":"%s","active":null}' "$backend")"
    return 0
  fi
  if firewall_active; then active=true; else active=false; fi
  if [ "$active" = true ] && [ "$backend" = ufw ]; then
    emit_check firewall ok \
      "ufw is active; the installer will open TCP port $OPT_PORT automatically and change nothing else" \
      "$(printf '{"backend":"ufw","active":true,"ruleToApply":"ufw allow %s/tcp"}' "$OPT_PORT")"
  elif [ "$active" = true ]; then
    emit_check firewall fail \
      "$backend is active, and Hive cannot configure it automatically" \
      "$(printf '{"backend":"%s","active":true,"ruleToApply":null}' "$backend")" \
      FIREWALL_RULE_FAILED
  else
    emit_check firewall ok \
      "no active firewall; the installer will not enable one, and port $OPT_PORT will be reachable from anywhere that can route to this server" \
      "$(printf '{"backend":"%s","active":false,"ruleToApply":null}' "$backend")"
  fi
}

preflight_ssh_key() {
  [ -n "$OPT_SSH_KEY" ] || return 0
  if ssh_key_valid "$OPT_SSH_KEY"; then
    emit_check ssh_key ok "the supplied public key is a valid OpenSSH public key" \
      "$(printf '{"type":"%s"}' "$(awk '{print $1}' <<<"$OPT_SSH_KEY")")"
  else
    emit_check ssh_key fail "the supplied public key is not a valid OpenSSH public key" \
      '' SSH_KEY_INVALID
  fi
}

run_preflight() {
  emit "$(printf '"event":"preflight_start","runId":"%s","scriptVersion":"%s"' \
    "$RUN_ID" "$SCRIPT_VERSION")"
  preflight_os
  preflight_arch
  preflight_privilege
  preflight_existing_install
  preflight_port
  preflight_dir install_dir "the install directory" "$HIVE_OPT" "$HIVE_INSTALL_MIN_MB"
  preflight_dir data_dir "the data directory" "$HIVE_DATA_DIR" "$HIVE_DATA_MIN_MB"
  preflight_firewall
  preflight_ssh_key
  emit_preflight_summary
}
