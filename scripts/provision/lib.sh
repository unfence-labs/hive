# shellcheck shell=bash
# Hive provision framework: NDJSON emit, resumable step state, locking, traps.
# Sourced by the built provision.sh. See docs/install-flow-implementation-plan.md 5.1.

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
ENV_FILE="${HIVE_ENV_FILE:-$HIVE_VAR_DIR/provision.env}"

# Error taxonomy — MUST stay identical to shared/setup-errors.ts (contract test).
# shellcheck disable=SC2034  # read by the bash/TS contract test
SETUP_ERROR_CODES="UNSUPPORTED_OS UNSUPPORTED_ARCH SERVER_NOT_PRISTINE EXISTING_INSTALL \
APT_LOCK_TIMEOUT APT_FAILURE NETWORK CHECKSUM_MISMATCH TS_AUTHKEY_INVALID TS_DAEMON_DOWN \
UFW_FAILURE RELEASE_DOWNLOAD_FAILED SERVICE_START_FAILED HEALTH_TIMEOUT SSH_AUTH_FAILED \
SSH_HOST_KEY_CHANGED SSH_UNREACHABLE SSH_NO_ROOT CLAUDE_PASTEBACK_BROKEN DEVICE_CODE_EXPIRED \
CODEX_DEVICE_AUTH_DISABLED GH_POLL_STUCK INTERRUPTED CONCURRENT_RUN UNKNOWN"

SEQ=0
RUN_ID=""
CURRENT_STEP=""
STEP_DATA=""            # steps may set this to a JSON object string before returning
STEPS_PLANNED=()

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

now_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

emit() {
  # emit '<json body without braces>'
  SEQ=$((SEQ + 1))
  printf '{"v":1,"seq":%d,"ts":"%s",%s}\n' "$SEQ" "$(now_ts)" "$1" | tee -a "$LOG_FILE"
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

emit_run_end() { emit "$(printf '"event":"run_end","status":"%s"' "$1")"; }

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

# Run a command, streaming each output line as a throttled NDJSON log event.
run_logged() {
  local id="$1"; shift
  "$@" 2>&1 | while IFS= read -r line; do emit_log "$id" "${line:0:2000}"; done
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

fail() {
  # fail <errorCode> <message> [exitCode]
  local code="$1" msg="$2" rc="${3:-1}"
  trap - ERR
  if [ -n "$CURRENT_STEP" ]; then
    emit_step "$CURRENT_STEP" error "$(printf '"exitCode":%d,"errorCode":"%s","detail":"%s"' \
      "$rc" "$code" "$(json_escape "$msg")")"
    mark_step "$CURRENT_STEP" error
  fi
  emit_run_end error
  exit 1
}

die() { fail "$1" "$2" "${3:-1}"; }   # typed failure from within a step

on_err() {
  local rc=$?
  fail "${STEP_ERR_CODE:-UNKNOWN}" "step ${CURRENT_STEP:-?} failed (rc=$rc)" "$rc"
}

# --- Step runner ---

run_step() {
  # run_step <id>  — step_<id> and optional guard_<id>/title_<id> must be defined
  local id="$1"
  local title; title="$(declare -f "title_$id" >/dev/null 2>&1 && "title_$id" || printf '%s' "$id")"

  if [ "$(step_status "$id")" = "ok" ]; then
    if ! declare -f "guard_$id" >/dev/null 2>&1 || guard_$id; then
      # skipdata_<id> lets a skipped step still report data the client needs
      # (e.g. tailscale_up's tailnet IP on a resume).
      if declare -f "skipdata_$id" >/dev/null 2>&1; then
        emit_step "$id" skip "$(printf '"reason":"already-satisfied","data":%s' "$(skipdata_$id)")"
      else
        emit_step "$id" skip '"reason":"already-satisfied"'
      fi
      return 0
    fi
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

load_env_file() {
  [ -f "$ENV_FILE" ] || return 0
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
}

bootstrap() {
  require_root
  mkdir -p "$HIVE_VAR_DIR" "$STATE_DIR"
  chmod 700 "$HIVE_VAR_DIR"
  : >>"$LOG_FILE"
  acquire_lock
  load_env_file
  trap on_err ERR

  # A newer script version invalidates prior state (step semantics may change).
  if [ -f "$STATE_FILE" ] && ! grep -q "\"scriptVersion\": \"$SCRIPT_VERSION\"" "$STATE_FILE" 2>/dev/null; then
    [ "${HIVE_KEEP_STATE:-}" = 1 ] || rm -f "$STATE_DIR"/* 2>/dev/null || true
  fi

  RUN_ID="r-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  local resume=false
  [ -n "$(ls -A "$STATE_DIR" 2>/dev/null || true)" ] && resume=true
  emit_run_start "$resume"
}

reset_state() { rm -rf "$STATE_DIR" "$STATE_FILE"; mkdir -p "$STATE_DIR"; }
