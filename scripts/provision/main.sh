# shellcheck shell=bash
# Hive provision entrypoint. Concatenated after lib.sh + steps.sh by build.sh.

OPT_SKIP_TAILSCALE=0
OPT_SKIP_UFW=0
OPT_SKIP_NODE=0
OPT_HOST="127.0.0.1"
OPT_PORT="${HIVE_PORT:-3000}"
OPT_RELEASE_FILE=""
DO_RESET=0

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --skip-tailscale) OPT_SKIP_TAILSCALE=1 ;;
      --skip-ufw) OPT_SKIP_UFW=1 ;;
      --skip-node) OPT_SKIP_NODE=1 ;;
      --host) OPT_HOST="$2"; shift ;;
      --port) OPT_PORT="$2"; shift ;;
      --release-file) OPT_RELEASE_FILE="$2"; shift ;;
      --reset) DO_RESET=1 ;;
      *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
  done
  HIVE_VERSION="${HIVE_VERSION:-$SCRIPT_VERSION}"
}

# Tailscale joins the tailnet right after the probes: `tailscale up` is the
# first real use of the auth key (there is no way to pre-validate one without
# consuming it), so a dead key must fail in seconds — before the slow apt/node
# steps. Steps are name-keyed, so resume across this reordering is safe.
STEPS=(
  probe_os probe_env install_tailscale tailscale_up
  apt_baseline install_node create_user configure_ufw
  install_release write_secrets write_units install_helpers enable_service health_check
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
