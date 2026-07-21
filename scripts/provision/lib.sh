# shellcheck shell=bash
# Hive provision framework: NDJSON emit, resumable step state, locking, traps.
# Sourced by the built provision.sh.

# -E (errtrace) is required: without it the ERR trap does not fire inside
# functions, so a failing step would kill the run with no typed error event.
set -Eeuo pipefail

SCRIPT_VERSION="${SCRIPT_VERSION:-0.0.0-dev}"

# Runtime dirs (overridable for tests).
HIVE_VAR_DIR="${HIVE_VAR_DIR:-/var/lib/hive}"
STATE_DIR="$HIVE_VAR_DIR/state"
STATE_FILE="$HIVE_VAR_DIR/provision-state.json"
LOG_FILE="${HIVE_LOG_FILE:-$HIVE_VAR_DIR/provision.log.ndjson}"
LOCK_FILE="$HIVE_VAR_DIR/provision.lock"

# Provision-emitted error codes. The shared taxonomy also contains client and
# guided-setup errors; the contract test asserts this list stays a subset.
# shellcheck disable=SC2034  # read by the bash/TS contract test
SETUP_ERROR_CODES="UNSUPPORTED_OS UNSUPPORTED_ARCH SERVER_NOT_PRISTINE EXISTING_INSTALL \
APT_FAILURE CHECKSUM_MISMATCH TS_AUTHKEY_INVALID TS_DAEMON_DOWN UFW_FAILURE \
RELEASE_DOWNLOAD_FAILED SERVICE_START_FAILED HEALTH_TIMEOUT SSH_NO_ROOT CONCURRENT_RUN UNKNOWN"

SEQ=0
RUN_ID=""
CURRENT_STEP=""
STEP_DATA=""            # steps may set this to a JSON object string before returning
STEPS_PLANNED=()
SENSITIVE_FILE=""
DOWNLOAD_FILE=""

# --- JSON helpers (no jq dependency: emit runs before apt installs jq) ---

json_escape() {
  # Escape a string for embedding in JSON.
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  printf '%s' "$s"
}

emit() {
  # emit '<json body without braces>'
  SEQ=$((SEQ + 1))
  printf '{"v":1,"seq":%d,"ts":"%s",%s}\n' "$SEQ" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" | tee -a "$LOG_FILE"
}

emit_run_start() {
  local resume="$1" planned=""
  local s
  for s in "${STEPS_PLANNED[@]}"; do
    planned+="\"$s\","
  done
  planned="[${planned%,}]"
  emit "$(printf '"event":"run_start","runId":"%s","scriptVersion":"%s","resume":%s,"stepsPlanned":%s' \
    "$RUN_ID" "$SCRIPT_VERSION" "$resume" "$planned")"
}

emit_run_end() {
  local status="$1" code="${2:-}" detail="${3:-}"
  if [ -n "$code" ]; then
    emit "$(printf '"event":"run_end","status":"%s","errorCode":"%s","detail":"%s"' \
      "$status" "$code" "$(json_escape "$detail")")"
  else
    emit "$(printf '"event":"run_end","status":"%s"' "$status")"
  fi
}

emit_step() {
  # emit_step <id> <status> [extra-json]
  local id="$1" status="$2" extra="${3:-}"
  local body
  body="$(printf '"step":"%s","status":"%s"' "$id" "$status")"
  [ -n "$extra" ] && body="$body,$extra"
  emit "$body"
}

emit_log() {
  # emit_log <stepId> <line>
  emit_step "$1" log "$(printf '"line":"%s"' "$(json_escape "$2")")"
}

# Run a command, streaming each output line as an NDJSON log event. Process
# substitution keeps the read loop in this shell (SEQ must stay monotonic in
# the parent); `wait $!` propagates the command's exit status to the ERR trap.
run_logged() {
  local id="$1" line; shift
  while IFS= read -r line || [ -n "$line" ]; do
    emit_log "$id" "${line:0:2000}"
  done < <("$@" 2>&1)
  wait $!
}

# --- State (markers are the source of truth; state.json is a rendered view) ---

step_status() { cat "$STATE_DIR/$1" 2>/dev/null || printf pending; }

render_state_json() {
  local tmp="$STATE_FILE.tmp" first=1 id st
  {
    printf '{\n  "schema": 1,\n  "scriptVersion": "%s",\n  "runId": "%s",\n  "steps": {\n' \
      "$SCRIPT_VERSION" "$RUN_ID"
    for id in "${STEPS_PLANNED[@]}"; do
      st="$(step_status "$id")"
      [ "$first" = 1 ] && first=0 || printf ',\n'
      printf '    "%s": {"status":"%s"}' "$id" "$st"
    done
    printf '\n  }\n}\n'
  } >"$tmp"
  mv -f "$tmp" "$STATE_FILE"
}

mark_step() {
  printf '%s' "$2" >"$STATE_DIR/$1"
  render_state_json
}

# --- Failure handling ---

die() {
  # die <errorCode> <message> [exitCode]
  local code="$1" msg="$2" rc="${3:-1}"
  trap - ERR
  if [ -n "$CURRENT_STEP" ]; then
    emit_step "$CURRENT_STEP" error "$(printf '"exitCode":%d,"errorCode":"%s","detail":"%s"' \
      "$rc" "$code" "$(json_escape "$msg")")"
    mark_step "$CURRENT_STEP" error
  fi
  emit_run_end error "$code" "$msg"
  exit 1
}

on_err() {
  # Include the exact failing command and line so unexpected failures are
  # debuggable from the error panel alone.
  local rc=$?
  die "${STEP_ERR_CODE:-UNKNOWN}" \
    "step ${CURRENT_STEP:-?} failed (rc=$rc) at line ${BASH_LINENO[0]:-?}: ${BASH_COMMAND:-?}" "$rc"
}

# --- Step runner ---

run_step() {
  # run_step <id>  — step_<id> and optional guard_<id>/title_<id> must be defined
  local id="$1"
  local title; title="$(declare -f "title_$id" >/dev/null 2>&1 && "title_$id" || printf '%s' "$id")"

  local status; status="$(step_status "$id")"
  if { declare -f "guard_$id" >/dev/null 2>&1 && guard_$id; } || \
    { [ "$status" = "ok" ] && ! declare -f "guard_$id" >/dev/null 2>&1; }; then
    [ "$status" = "ok" ] || mark_step "$id" ok
    # skipdata_<id> lets a skipped step still report data the client needs
    # (e.g. tailscale_up's tailnet IP on a resume).
    if declare -f "skipdata_$id" >/dev/null 2>&1; then
      emit_step "$id" skip "$(printf '"reason":"already-satisfied","data":%s' "$(skipdata_$id)")"
    else
      emit_step "$id" skip '"reason":"already-satisfied"'
    fi
    return 0
  fi

  CURRENT_STEP="$id"
  STEP_ERR_CODE=""
  STEP_DATA=""
  emit_step "$id" start "$(printf '"title":"%s"' "$(json_escape "$title")")"
  local t0=$SECONDS
  "step_$id"                                   # set -e + ERR trap active inside
  local dt=$(((SECONDS - t0) * 1000))
  mark_step "$id" ok
  if [ -n "$STEP_DATA" ]; then
    emit_step "$id" ok "$(printf '"durationMs":%d,"data":%s' "$dt" "$STEP_DATA")"
  else
    emit_step "$id" ok "$(printf '"durationMs":%d' "$dt")"
  fi
  CURRENT_STEP=""

  # Test hook: simulate a crash right after a given step completed.
  if [ "${HIVE_TEST_DIE_AFTER:-}" = "$id" ]; then
    echo "TEST: dying after step $id" >&2
    exit 137
  fi
}

# --- apt helper: non-interactive, lock-tolerant, idempotent ---

apt_install() {
  DEBIAN_FRONTEND=noninteractive apt-get install -q -y \
    -o Dpkg::Options::=--force-confdef \
    -o Dpkg::Options::=--force-confold \
    -o DPkg::Lock::Timeout=300 "$@"
}

# --- Bootstrap: dirs, lock, env, planned steps, run_start ---

require_root() { [ "$(id -u)" = 0 ] || die SSH_NO_ROOT "provision must run as root"; }

acquire_lock() {
  exec 9>"$LOCK_FILE"
  flock -n 9 || die CONCURRENT_RUN "another provision run holds the lock"
}

bootstrap() {
  require_root
  mkdir -p "$HIVE_VAR_DIR" "$STATE_DIR"
  chmod 700 "$HIVE_VAR_DIR"
  : >>"$LOG_FILE"
  acquire_lock
  find "$HIVE_VAR_DIR" -maxdepth 1 -type f \
    \( -name 'tailscale-auth.*' -o -name 'release.*.tar.gz' \) -delete
  trap on_err ERR
  trap 'rm -f "${SENSITIVE_FILE:-}" "${DOWNLOAD_FILE:-}"' EXIT

  # A newer script version invalidates prior state (step semantics may change).
  if [ -f "$STATE_FILE" ] && ! grep -q "\"scriptVersion\": \"$SCRIPT_VERSION\"" "$STATE_FILE" 2>/dev/null; then
    rm -f "$STATE_DIR"/* 2>/dev/null || true
  fi

  RUN_ID="r-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  local resume=false
  [ -n "$(ls -A "$STATE_DIR" 2>/dev/null || true)" ] && resume=true
  emit_run_start "$resume"
}

reset_state() { rm -rf "$STATE_DIR" "$STATE_FILE"; mkdir -p "$STATE_DIR"; }
