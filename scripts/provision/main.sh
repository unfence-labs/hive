# shellcheck shell=bash
# Hive provision entrypoint. Concatenated after lib.sh + steps.sh by build.sh.

OPT_LOCAL_DEV=0
OPT_TEST_SKIP_UFW=0
OPT_TEST_SKIP_NODE=0
OPT_HOST="127.0.0.1"
OPT_PORT="${HIVE_PORT:-3000}"
OPT_RELEASE_FILE=""
DO_RESET=0

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --local-dev) OPT_LOCAL_DEV=1 ;;
      --test-skip-ufw) OPT_TEST_SKIP_UFW=1 ;;
      --test-skip-node) OPT_TEST_SKIP_NODE=1 ;;
      --host|--port|--dev-release-file)
        [ "$#" -ge 2 ] || { echo "missing value for $1" >&2; exit 2; }
        case "$1" in
          --host) OPT_HOST="$2" ;;
          --port) OPT_PORT="$2" ;;
          --dev-release-file) OPT_RELEASE_FILE="$2" ;;
        esac
        shift
        ;;
      --reset) DO_RESET=1 ;;
      *) echo "unknown option: $1" >&2; exit 2 ;;
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
  if [ -n "$OPT_RELEASE_FILE" ] && [[ "$HIVE_VERSION" != *-* ]]; then
    echo "--dev-release-file is only available for prerelease development builds" >&2
    exit 2
  fi
}

# Tailscale joins the tailnet right after the probes: `tailscale up` is the
# first real use of the auth key (there is no way to pre-validate one without
# consuming it), so a dead key must fail in seconds — before the slow apt/node
# steps. Steps are name-keyed, so resume across this reordering is safe.
STEPS=(
  probe_os probe_env remove_legacy_helpers install_tailscale tailscale_up
  apt_baseline install_gh install_node create_user configure_ufw
  install_release write_secrets write_units enable_service health_check
)

main() {
  parse_args "$@"
  STEPS_PLANNED=("${STEPS[@]}")
  bootstrap
  [ "$DO_RESET" = 1 ] && reset_state
  local step
  for step in "${STEPS[@]}"; do run_step "$step"; done
  emit_run_end ok
}

main "$@"
