# shellcheck shell=bash
# shellcheck disable=SC2034  # globals are shared across the bundled fragments
# Hive provision entrypoint. Concatenated after lib.sh + steps.sh by build.sh.

# 9420 is the production port (backend/ecosystem.config.cjs); 3000 is the
# development one and is never used here.
OPT_HOST="0.0.0.0"
OPT_PORT="${HIVE_PORT:-9420}"
OPT_RELEASE_FILE=""
ARCH_TAG=""
HIVE_VERSION=""
DO_RESET=0

usage() {
  cat <<'EOF'
Hive server installer.

  curl -fsSL <url>/provision.sh | bash
  curl -fsSL <url>/provision.sh | bash -s -- --port 9420

Options:
  --host <addr>          Bind address for the backend (default 0.0.0.0)
  --port <n>             Port for the backend (default 9420)
  --release-file <path>  Install a local release tarball instead of downloading
                         (prerelease script versions only)
  --reset                Discard recorded step state and run every step again
  -h, --help             Show this help

Requires root, systemd, and Ubuntu 22.04/24.04 or Debian 12/13 on x86-64 or arm64.
Progress is written to stdout as NDJSON, one record per line.
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --host|--port|--release-file)
        [ "$#" -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
        case "$1" in
          --host) OPT_HOST="$2" ;;
          --port) OPT_PORT="$2" ;;
          --release-file) OPT_RELEASE_FILE="$2" ;;
        esac
        shift
        ;;
      --reset) DO_RESET=1 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done

  if [[ ! "$OPT_HOST" =~ ^[A-Za-z0-9.:-]+$ ]] || [[ "$OPT_HOST" = -* ]]; then
    echo "invalid bind host: $OPT_HOST" >&2
    exit 2
  fi
  if [[ ! "$OPT_PORT" =~ ^[0-9]+$ ]] || [ "$OPT_PORT" -lt 1 ] || [ "$OPT_PORT" -gt 65535 ]; then
    echo "invalid port: $OPT_PORT" >&2
    exit 2
  fi

  HIVE_VERSION="${HIVE_VERSION:-$SCRIPT_VERSION}"
  if [[ ! "$HIVE_VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
    echo "invalid Hive version: $HIVE_VERSION" >&2
    exit 2
  fi
  # A local tarball and an alternate release origin are development and test
  # affordances: a published release must always come from the published URL,
  # verified against its published checksum.
  if [[ "$HIVE_VERSION" != *-* ]]; then
    if [ -n "$OPT_RELEASE_FILE" ]; then
      echo "--release-file is only available for prerelease script versions" >&2
      exit 2
    fi
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
  probe_os probe_env apt_baseline create_user install_node install_agent_clis
  install_release generate_token write_secrets write_units enable_service
  health_check verify_auth
)

main() {
  parse_args "$@"
  detect_arch
  STEPS_PLANNED=("${STEPS[@]}")
  bootstrap
  [ "$DO_RESET" = 1 ] && reset_state
  local step
  for step in "${STEPS[@]}"; do run_step "$step"; done
  emit_run_end ok
}

main "$@"
