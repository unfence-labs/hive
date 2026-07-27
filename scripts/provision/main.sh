# shellcheck shell=bash
# shellcheck disable=SC2034  # globals are shared across the bundled fragments
# Hive provision entrypoint. Concatenated after lib.sh + steps.sh by build.sh.

# 9420 is the production port (backend/ecosystem.config.cjs); 3000 is the
# development one and is never used here.
OPT_PORT="${OPT_ENV_PORT:-9420}"
OPT_INSTALL_DIR="$OPT_ENV_INSTALL_DIR"
OPT_DATA_DIR="$OPT_ENV_DATA_DIR"
OPT_FIREWALL_IFACE="$OPT_ENV_FIREWALL_IFACE"
OPT_SSH_KEY="$OPT_ENV_SSH_KEY"
OPT_PREFLIGHT=0
ARCH_TAG=""
HIVE_VERSION=""
DO_RESET=0

usage() {
  cat <<'EOF'
Hive server installer.

  curl -fsSL <url>/provision.sh | bash
  curl -fsSL <url>/provision.sh | bash -s -- --port 9420
  curl -fsSL <url>/provision.sh | bash -s -- --preflight

Options (each has an environment-variable equivalent that the flag overrides):

  --preflight               Report what this server looks like and change
                            nothing at all. Always exits 0.
  --install-dir <path>      Where Hive and its private runtime live
                            (default /opt/hive, $HIVE_INSTALL_DIR)
  --data-dir <path>         Where projects, worktrees and sessions live — the
                            directory that grows
                            (default /home/hive/.hive, $HIVE_DATA_DIR)
  --port <n>                Port for the backend (default 9420, $HIVE_PORT)
  --firewall-interface <if> Scope the firewall rule to one network interface
                            instead of opening the port to everyone
                            ($HIVE_FIREWALL_INTERFACE). Only ever consulted
                            when a firewall is already active.
  --ssh-public-key <key>    Authorize this OpenSSH public key on the hive
                            service account, so an editor or terminal session
                            connects as hive and not as root
                            ($HIVE_SSH_PUBLIC_KEY)
  --reset                   Discard recorded step state and run every step again
  -h, --help                Show this help

The firewall is never enabled and its default policy is never changed. If a
firewall is already active, exactly one rule is added: Hive's own port, or
inbound on --firewall-interface when one is given. If none is active, nothing
is done and that is reported.

An uninstall script is written to <install-dir>/hive-uninstall.sh, carrying the
paths this run used. It keeps your data unless you pass --purge.

Requires root, systemd, and Ubuntu 22.04/24.04 or Debian 12/13 on x86-64 or arm64.
Progress is written to stdout as NDJSON, one record per line.
EOF
}

missing() { echo "missing value for $1" >&2; exit 2; }

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --port) [ $# -ge 2 ] || missing "$1"; OPT_PORT="$2"; shift ;;
      --install-dir) [ $# -ge 2 ] || missing "$1"; OPT_INSTALL_DIR="$2"; shift ;;
      --data-dir) [ $# -ge 2 ] || missing "$1"; OPT_DATA_DIR="$2"; shift ;;
      --firewall-interface) [ $# -ge 2 ] || missing "$1"; OPT_FIREWALL_IFACE="$2"; shift ;;
      --ssh-public-key) [ $# -ge 2 ] || missing "$1"; OPT_SSH_KEY="$2"; shift ;;
      --preflight) OPT_PREFLIGHT=1 ;;
      --reset) DO_RESET=1 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done

  # Trailing whitespace and CRs survive copy/paste out of a terminal and would
  # otherwise be appended verbatim to authorized_keys.
  OPT_SSH_KEY="${OPT_SSH_KEY//$'\r'/}"
  OPT_SSH_KEY="${OPT_SSH_KEY#"${OPT_SSH_KEY%%[![:space:]]*}"}"
  OPT_SSH_KEY="${OPT_SSH_KEY%"${OPT_SSH_KEY##*[![:space:]]}"}"

  if [[ ! "$OPT_PORT" =~ ^[0-9]+$ ]] || [ "$OPT_PORT" -lt 1 ] || [ "$OPT_PORT" -gt 65535 ]; then
    echo "invalid port: $OPT_PORT" >&2
    exit 2
  fi
  # The interface name reaches `ufw allow in on <if>` unquoted, so a leading
  # dash would be read there as an option. Empty is the normal case: no
  # interface means the rule opens the port.
  if [ -n "$OPT_FIREWALL_IFACE" ] &&
     { [[ ! "$OPT_FIREWALL_IFACE" =~ ^[A-Za-z0-9._-]+$ ]] || [[ "$OPT_FIREWALL_IFACE" = -* ]]; }; then
    echo "invalid network interface name: $OPT_FIREWALL_IFACE" >&2
    exit 2
  fi
  # Both directories become systemd unit values, tar destinations and rm -rf
  # targets in the generated uninstaller. Absolute, no traversal, no shell
  # metacharacters, and never the filesystem root.
  local d
  for d in "$OPT_INSTALL_DIR" "$OPT_DATA_DIR"; do
    [ -n "$d" ] || continue
    if [[ ! "$d" =~ ^(/[A-Za-z0-9._-]+)+/?$ ]] || [[ "$d" == *".."* ]]; then
      echo "invalid directory: $d (must be an absolute path with no traversal)" >&2
      exit 2
    fi
  done
  OPT_INSTALL_DIR="${OPT_INSTALL_DIR%/}"
  OPT_DATA_DIR="${OPT_DATA_DIR%/}"

  # The backend release always matches the script that installs it; build.sh
  # already validated the version string.
  HIVE_VERSION="$SCRIPT_VERSION"
  # An alternate release origin is a development and test affordance: a
  # published release must always come from the published URL, verified against
  # its published checksum.
  if [[ "$HIVE_VERSION" != *-* ]]; then
    HIVE_RELEASE_BASE_URL=""
  fi
}

detect_arch() {
  case "$(uname -m)" in
    x86_64) ARCH_TAG=x64 ;;
    aarch64|arm64) ARCH_TAG=arm64 ;;
    *) ARCH_TAG="" ;;
  esac
}

STEPS=(
  probe_os probe_env apt_baseline create_user authorize_ssh_key install_node
  install_agent_clis install_release generate_token write_secrets write_units
  write_uninstall firewall_rule enable_service health_check verify_auth
)

main() {
  parse_args "$@"
  detect_arch
  resolve_paths

  # Preflight forks off before bootstrap: bootstrap creates directories, opens
  # a log file and takes a lock, and a mode whose entire contract is "changes
  # nothing" cannot do any of that.
  if [ "$OPT_PREFLIGHT" = 1 ]; then
    preflight_bootstrap
    run_preflight
    emit_run_end ok
    exit 0
  fi

  STEPS_PLANNED=("${STEPS[@]}")
  bootstrap
  [ "$DO_RESET" = 1 ] && reset_state
  local step
  for step in "${STEPS[@]}"; do run_step "$step"; done
  emit_run_end ok
}

main "$@"
