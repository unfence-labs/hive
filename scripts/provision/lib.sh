# shellcheck shell=bash
# Hive provision framework: NDJSON emit, resumable step state, locking, traps.
# Concatenated into the single-file provision.sh by build.sh.

# -E (errtrace) is required: without it the ERR trap does not fire inside
# functions, so a failing step would kill the run with no typed error event.
set -Eeuo pipefail

SCRIPT_VERSION="${SCRIPT_VERSION:-0.0.0-dev}"

# Environment defaults for the operator-settable options, in the k3s style:
# one prefixed variable per option, each with a documented default and a
# command-line equivalent that wins over it.
#
# They are captured here, at the very top of the bundle, and not in parse_args:
# steps.sh declares internal globals of the same names further down, and by the
# time main.sh runs they would have shadowed the operator's environment.
# shellcheck disable=SC2034  # consumed by parse_args in main.sh
OPT_ENV_INSTALL_DIR="${HIVE_INSTALL_DIR:-}"
# shellcheck disable=SC2034
OPT_ENV_DATA_DIR="${HIVE_DATA_DIR:-}"
# shellcheck disable=SC2034
OPT_ENV_PORT="${HIVE_PORT:-}"
# shellcheck disable=SC2034
OPT_ENV_SSH_KEY="${HIVE_SSH_PUBLIC_KEY:-}"

# Runtime dirs (overridable for tests).
HIVE_VAR_DIR="${HIVE_VAR_DIR:-/var/lib/hive}"
STATE_DIR="$HIVE_VAR_DIR/state"
STATE_FILE="$HIVE_VAR_DIR/provision-state.json"
LOG_FILE="${HIVE_LOG_FILE:-$HIVE_VAR_DIR/provision.log.ndjson}"
LOCK_FILE="$HIVE_VAR_DIR/provision.lock"

# Error taxonomy: every code a `die` or STEP_ERR_CODE names must be declared in
# SETUP_ERROR_CODES in shared/setup-errors.ts; test/provision/contract.sh
# collects the call sites and asserts it.

SEQ=0
RUN_ID=""
CURRENT_STEP=""
STEP_ERR_CODE=""
STEP_DATA=""            # JSON object emitted on the step's ok record
STEP_SECRET_DATA=""     # JSON object emitted to stdout only; STEP_DATA goes to the log
STEPS_PLANNED=()
SENSITIVE_FILE=""
DOWNLOAD_FILE=""

# --- JSON helpers (no jq dependency: emit runs before any package is installed) ---

json_escape() {
  # Escape a string for embedding in JSON. Remaining C0/DEL control bytes
  # (ANSI escapes in apt/curl output) are stripped: raw they are invalid JSON.
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\n'/\\n}"
  s="${s//[$'\x01'-$'\x1f'$'\x7f']/}"
  printf '%s' "$s"
}

# The progress stream is the contract; the log file is a convenience. Failures
# before the log exists (running as the wrong user, an unwritable /var/lib)
# must still reach stdout as a typed record, so the append can never fail the run.
emit() {
  # emit '<json body without braces>'
  local line
  SEQ=$((SEQ + 1))
  line="$(printf '{"v":1,"seq":%d,"ts":"%s",%s}' "$SEQ" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1")"
  printf '%s\n' "$line"
  printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null || true
}

# Emit a record whose stdout form carries a secret. The log file receives the
# redacted form under the same sequence number, so the access token never
# lands on disk while the stream stays replayable.
emit_secret() {
  # emit_secret '<stdout body>' '<log body>'
  local ts
  SEQ=$((SEQ + 1))
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"v":1,"seq":%d,"ts":"%s",%s}\n' "$SEQ" "$ts" "$2" >>"$LOG_FILE" 2>/dev/null || true
  printf '{"v":1,"seq":%d,"ts":"%s",%s}\n' "$SEQ" "$ts" "$1"
}

emit_run_start() {
  local resume="$1" planned="" s
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
  local id="$1" status="$2" extra="${3:-}" body
  body="$(printf '"step":"%s","status":"%s"' "$id" "$status")"
  [ -n "$extra" ] && body="$body,$extra"
  emit "$body"
}

# --- Preflight reporting ---
#
# Preflight is a read-only mode: it emits one record per check and a summary,
# and always exits 0. A check that fails is a finding, not a run failure —
# the client decides what to do with it, which is why nothing here calls `die`.
PREFLIGHT_OK=true
PREFLIGHT_BLOCKERS=""

emit_check() {
  # emit_check <id> <ok|fail|warn> <detail> [data-json] [errorCode]
  local id="$1" status="$2" detail="$3" data="${4:-}" code="${5:-}" body
  body="$(printf '"event":"preflight_check","check":"%s","status":"%s","detail":"%s"' \
    "$id" "$status" "$(json_escape "$detail")")"
  [ -n "$data" ] && body="$body,$(printf '"data":%s' "$data")"
  if [ "$status" = fail ]; then
    PREFLIGHT_OK=false
    PREFLIGHT_BLOCKERS+="$id "
    [ -n "$code" ] && body="$body,$(printf '"errorCode":"%s"' "$code")"
  fi
  emit "$body"
}

emit_preflight_summary() {
  local blockers="" b
  for b in $PREFLIGHT_BLOCKERS; do blockers+="\"$b\","; done
  emit "$(printf '"event":"preflight","ok":%s,"blockers":[%s]' \
    "$PREFLIGHT_OK" "${blockers%,}")"
}

emit_log() {
  # emit_log <stepId> <line>
  local line="$2"
  if [ "${#line}" -gt 2000 ]; then
    # Byte-wise truncation can split a UTF-8 sequence; iconv -c drops the
    # partial tail so the emitted JSON stays valid UTF-8.
    line="$(printf '%s' "${line:0:2000}" | iconv -f UTF-8 -t UTF-8 -c 2>/dev/null || printf '%s' "${line:0:2000}")"
  fi
  emit_step "$1" log "$(printf '"line":"%s"' "$(json_escape "$line")")"
}

# Run a command, streaming each output line as an NDJSON log event. Process
# substitution keeps the read loop in this shell (SEQ must stay monotonic in
# the parent); `wait $!` propagates the command's exit status to the ERR trap.
# The child's stdin is /dev/null: under `curl | bash` fd 0 is the script
# itself, and any child that reads it would swallow the rest of the source.
run_logged() {
  local id="$1" line; shift
  while IFS= read -r line || [ -n "$line" ]; do
    emit_log "$id" "$line"
  done < <("$@" 2>&1 </dev/null)
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

# A step is `step_<id>`, with optional `guard_<id>` (skip when it succeeds),
# `title_<id>`, and `skipdata_<id>`. A guard that always returns 1 marks a step
# that must re-run on every invocation.
run_step() {
  local id="$1" title status
  title="$(declare -f "title_$id" >/dev/null 2>&1 && "title_$id" || printf '%s' "$id")"

  status="$(step_status "$id")"
  if { declare -f "guard_$id" >/dev/null 2>&1 && "guard_$id"; } || \
     { [ "$status" = "ok" ] && ! declare -f "guard_$id" >/dev/null 2>&1; }; then
    [ "$status" = "ok" ] || mark_step "$id" ok
    if declare -f "skipdata_$id" >/dev/null 2>&1; then
      emit_step "$id" skip "$(printf '"reason":"already-satisfied","data":%s' "$("skipdata_$id")")"
    else
      emit_step "$id" skip '"reason":"already-satisfied"'
    fi
    return 0
  fi

  CURRENT_STEP="$id"
  STEP_ERR_CODE=""
  STEP_DATA=""
  STEP_SECRET_DATA=""
  emit_step "$id" start "$(printf '"title":"%s"' "$(json_escape "$title")")"
  "step_$id"                                   # set -e + ERR trap active inside
  mark_step "$id" ok
  if [ -n "$STEP_SECRET_DATA" ]; then
    local redacted="$STEP_DATA"
    [ -n "$redacted" ] || redacted='{}'
    emit_secret \
      "$(printf '"step":"%s","status":"ok","data":%s' "$id" "$STEP_SECRET_DATA")" \
      "$(printf '"step":"%s","status":"ok","data":%s' "$id" "$redacted")"
    STEP_SECRET_DATA=""
  elif [ -n "$STEP_DATA" ]; then
    emit_step "$id" ok "$(printf '"data":%s' "$STEP_DATA")"
  else
    emit_step "$id" ok
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

require_root() { [ "$(id -u)" = 0 ] || die NOT_ROOT "the Hive installer must run as root"; }

acquire_lock() {
  exec 9>"$LOCK_FILE"
  flock -n 9 || die CONCURRENT_RUN "another provision run holds the lock"
}

bootstrap() {
  require_root
  mkdir -p "$HIVE_VAR_DIR" "$STATE_DIR"
  chmod 700 "$HIVE_VAR_DIR"
  : >>"$LOG_FILE"
  chmod 600 "$LOG_FILE"
  acquire_lock
  # Half-downloaded artifacts from an interrupted run are never reused.
  find "$HIVE_VAR_DIR" -maxdepth 1 -type f \
    \( -name 'download.*' -o -name 'secret.*' \) -delete
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

# Preflight's whole contract is that it changes nothing, so it runs none of
# bootstrap: no directory is created, no lock is taken, no log is opened, and
# no trap can delete a file. The log sink is /dev/null, which keeps `emit`
# unchanged while writing the stream to stdout alone. Root is not required
# either — discovering that the caller cannot escalate is one of the findings.
preflight_bootstrap() {
  LOG_FILE=/dev/null
  RUN_ID="p-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
}
