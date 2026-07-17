# shellcheck shell=bash
# Hive provision entrypoint. Concatenated after lib.sh + steps.sh by build.sh.

OPT_SKIP_TAILSCALE=0
OPT_SKIP_UFW=0
OPT_SKIP_NODE=0
OPT_HOST="127.0.0.1"
OPT_PORT="${HIVE_PORT:-3000}"
OPT_RELEASE_FILE=""
OPT_APT_BASELINE=""
DO_RESET=0
DO_UNINSTALL=0

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --skip-tailscale) OPT_SKIP_TAILSCALE=1 ;;
      --skip-ufw) OPT_SKIP_UFW=1 ;;
      --skip-node) OPT_SKIP_NODE=1 ;;
      --host) OPT_HOST="$2"; shift ;;
      --port) OPT_PORT="$2"; shift ;;
      --release-file) OPT_RELEASE_FILE="$2"; shift ;;
      --apt-baseline) OPT_APT_BASELINE="$2"; shift ;;
      --reset) DO_RESET=1 ;;
      --uninstall) DO_UNINSTALL=1 ;;
      *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
    shift
  done
  [ -n "${HIVE_HOST_MODE:-}" ] && [ "$HIVE_HOST_MODE" = loopback ] && OPT_HOST="127.0.0.1"
  [ -n "${HIVE_PORT:-}" ] && OPT_PORT="$HIVE_PORT"
  APT_BASELINE="${OPT_APT_BASELINE:-$APT_BASELINE_DEFAULT}"
  HIVE_VERSION="${HIVE_VERSION:-$SCRIPT_VERSION}"
}

uninstall() {
  systemctl disable --now hive hive-updater.path 2>/dev/null || true
  rm -f /etc/systemd/system/hive.service /etc/systemd/system/hive-updater.{path,service}
  systemctl daemon-reload 2>/dev/null || true
  rm -rf "$HIVE_OPT" /etc/hive /usr/lib/hive
  echo "Hive removed. Data preserved at $HIVE_DATA_DIR" >&2
}

STEPS=(
  probe_os probe_env apt_baseline install_node create_user
  install_tailscale tailscale_up configure_ufw
  install_release write_secrets write_units enable_service health_check cleanup
)

main() {
  parse_args "$@"
  STEPS_PLANNED=("${STEPS[@]}")
  bootstrap
  [ "$DO_UNINSTALL" = 1 ] && { uninstall; exit 0; }
  [ "$DO_RESET" = 1 ] && reset_state
  local step
  for step in "${STEPS[@]}"; do run_step "$step"; done
  emit_run_end ok
}

main "$@"
