#!/usr/bin/env bash
# Contract tests for scripts/provision. Everything here runs in a second on any
# machine: no root, no containers, no network. The containerised end-to-end
# lane lives in test/provision/e2e-docker.sh.
# shellcheck disable=SC2016  # grep patterns quote literal $ from the shell sources
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PROV="$ROOT/scripts/provision"
FAILURES=0
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass() { echo "ok   $*"; }
fail() { echo "FAIL $*"; FAILURES=$((FAILURES + 1)); }

# expect <label> <command...>  — the command's failure is a test failure, never
# an errexit abort, so one broken contract still reports all the others.
expect() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi
}
refute() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then fail "$label"; else pass "$label"; fi
}

# Source lines only: the comments explaining a deliberate departure legitimately
# name the thing that departed, and so does the --help text, which documents the
# defaults and the prerequisites the script does not install.
CODE="$WORK/provision-code.txt"
grep -hv '^[[:space:]]*#' "$PROV"/lib.sh "$PROV"/steps.sh "$PROV"/main.sh \
  | sed '/^usage() {$/,/^}$/d' >"$CODE"

# Same, but keeping the --help text: it is part of the option surface, so it is
# held to the naming rules even though it is not code.
SPEECH="$WORK/provision-speech.txt"
grep -hv '^[[:space:]]*#' "$PROV"/lib.sh "$PROV"/steps.sh "$PROV"/main.sh \
  "$ROOT/shared/setup-errors.ts" >"$SPEECH"

# ---------------------------------------------------------------------------
# 1. The emitted error codes and the TypeScript taxonomy stay in sync
# ---------------------------------------------------------------------------
#
# The emitted set is collected from the `die`/STEP_ERR_CODE call sites, so a
# typo in a `die` call — which would otherwise reach a client as an unknown
# error only at failure time — and a declared code nothing can emit both fail
# the same diff.

ts_codes="$(sed -n '/^export const SETUP_ERROR_CODES = \[/,/^\] as const;/p' \
  "$ROOT/shared/setup-errors.ts" | grep -oE '"[A-Z_]+"' | tr -d '"' | sort -u)"
[ -n "$ts_codes" ] || { echo "FAIL: could not extract SETUP_ERROR_CODES from setup-errors.ts"; exit 1; }

emitted="$( { grep -ohE '\bdie [A-Z_]+' "$PROV"/*.sh | awk '{print $2}'
              grep -ohE '\bSTEP_ERR_CODE=[A-Z_]+' "$PROV"/*.sh | cut -d= -f2
            } | sort -u)"
diff_out="$(diff <(printf '%s\n' "$emitted") <(printf '%s\n' "$ts_codes") || true)"
if [ -z "$diff_out" ]; then
  pass "the script emits exactly the $(wc -w <<<"$ts_codes" | tr -d ' ') error codes shared/setup-errors.ts declares"
else
  fail "emitted error codes differ from SETUP_ERROR_CODES in shared/setup-errors.ts:"
  printf '%s\n' "$diff_out"
fi

missing_hints=""
while IFS= read -r code; do
  grep -q "^  $code:" "$ROOT/shared/setup-errors.ts" || missing_hints+="$code "
done <<<"$ts_codes"
if [ -z "$missing_hints" ]; then
  pass "every error code has a SETUP_ERROR_HINTS entry"
else
  fail "error codes without a hint: $missing_hints"
fi

# ---------------------------------------------------------------------------
# 2. Deliberate departures from the reference implementation stay departed
# ---------------------------------------------------------------------------

refute "no vendor runtime repository is added to the operator's system" \
  grep -niE 'nodesource|apt_install nodejs|apt-get install.*nodejs' "$CODE"

# Network reachability belongs outside the provisioner. No private-network vendor
# may appear in its option, error, variable, or message surface.
vendors="$(grep -niE 'tailscale|tailnet|zerotier|wireguard|nebula|headscale' "$SPEECH" || true)"
if [ -z "$vendors" ]; then
  pass "no private-network vendor is named in an option, a code, a variable or a message"
else
  fail "a vendor name reached the option surface: $(tr '\n' ' ' <<<"$vendors")"
fi

refute "the development port 3000 does not appear in the provisioner" \
  grep -nE '\b3000\b' "$CODE"

expect "the Node runtime is installed inside Hive's own install directory" \
  grep -q 'HIVE_RUNTIME_DIR="\$HIVE_OPT/runtime"' "$PROV/steps.sh"

expect "the default port is the production port 9420" \
  grep -q 'OPT_PORT="\${OPT_ENV_PORT:-9420}"' "$PROV/main.sh"

# ---------------------------------------------------------------------------
# 2b. The firewall: the single most dangerous thing in the reference branch
# ---------------------------------------------------------------------------
#
# The reference implementation set a default-deny inbound policy, allowed only
# port 22, and force-enabled ufw. On a server where ufw was installed but
# inactive that severs every service without an explicit rule; on a server whose
# SSH listens anywhere but 22 it severs the session running the install. None of
# those four commands may ever come back.

refute "the firewall is never enabled" grep -nE 'ufw[^|]*\b(--force )?enable\b' "$CODE"
refute "the firewall's default policy is never changed" grep -nE 'ufw[^|]*\bdefault\b' "$CODE"
refute "no blanket SSH rule is ever added" grep -nE 'ufw[^|]*allow[^|]*\b(ssh|22)\b' "$CODE"
refute "iptables and nftables rules are never written" \
  grep -nE '\biptables\b|\bip6tables\b|\bnft (add|insert|delete|flush)\b' "$CODE"
refute "no firewall other than ufw is ever modified" \
  grep -nE 'firewall-cmd[^|]*--(add|remove|set|reload|permanent)' "$CODE"

# The one rule that may be added opens only Hive's configured TCP port.
expect "the automatic firewall rule opens only the configured port" \
  grep -q 'spec="allow \$OPT_PORT/tcp"' "$PROV/steps.sh"

# `ufw <spec>` must be the only ufw invocation that is not a read of its state.
# String literals are stripped first: the step reports what it did in prose,
# and "ufw was already active" is not an invocation.
CODE_NOSTR="$WORK/provision-code-nostrings.txt"
sed 's/"[^"]*"//g' "$CODE" >"$CODE_NOSTR"
ufw_writes="$(grep -noE '\bufw [a-z-]+' "$CODE_NOSTR" | grep -vE 'ufw (status|delete)' || true)"
if [ "$(printf '%s\n' "$ufw_writes" | grep -c . || true)" -le 1 ]; then
  pass "ufw is invoked to read its status, to add one rule, and for nothing else"
else
  fail "unexpected ufw invocations: $(tr '\n' ' ' <<<"$ufw_writes")"
fi

expect "an inactive firewall is reported and left alone" \
  grep -q '"reason":"firewall-inactive"' "$PROV/steps.sh"
expect "the applied rule is reported on the progress stream" \
  grep -q '"ruleApplied":true,"rule":"ufw %s"' "$PROV/steps.sh"

# The pinned runtime major must match the Node the release tarball is compiled
# against, or the release's native addons cannot load.
node_pin="$(sed -n 's/^NODE_VERSION="\([0-9]*\)\..*/\1/p' "$PROV/steps.sh")"
release_major="$(sed -n 's/^RELEASE_NODE_MAJOR=\([0-9]*\)/\1/p' "$ROOT/scripts/release/build-backend-tarball.sh")"
if [ -n "$node_pin" ] && [ "$node_pin" = "$release_major" ]; then
  pass "the pinned runtime major ($node_pin) matches RELEASE_NODE_MAJOR"
else
  fail "pinned runtime major '$node_pin' does not match RELEASE_NODE_MAJOR '$release_major'"
fi

# Pinned digests must be well-formed, or a download would be "verified" against
# a value nothing can ever match — or, worse, against an empty string.
bad_pins=""
while IFS= read -r line; do
  value="${line#*=}"
  [[ "${value//\"/}" =~ ^[0-9a-f]{64}$ ]] || bad_pins+="${line%%=*} "
done < <(grep -E '^(NODE|GH)_SHA256_[A-Z0-9]+=' "$PROV/steps.sh")
if [ -z "$bad_pins" ]; then
  pass "every pinned checksum is a 64-character lowercase hex digest"
else
  fail "malformed pinned checksums: $bad_pins"
fi

# ---------------------------------------------------------------------------
# 3. The backend's startup dependency check is left alone
# ---------------------------------------------------------------------------

for tool in claude gh git; do
  expect "preflight still requires '$tool'" \
    bash -c 'grep -A4 "name: \"$2\"" "$1" | grep -q "required: true"' \
      _ "$ROOT/backend/src/utils/preflight.ts" "$tool"
done
expect "the provisioner installs the agent CLIs preflight requires" \
  grep -q 'for bin in claude codex gh; do' "$PROV/steps.sh"

# ---------------------------------------------------------------------------
# 4. Token handling: the plaintext never reaches disk or a process argument
# ---------------------------------------------------------------------------

expect "the access token is reported through the secret-only emit path" \
  grep -q 'STEP_SECRET_DATA="\$(printf .{"accessToken":"%s"}' "$PROV/steps.sh"

expect "the digest is computed with the printf builtin, not a process argument" \
  grep -q 'digest="\$(printf .%s. "\$token" | sha256sum' "$PROV/steps.sh"

expect "the environment file is root-owned and mode 600" \
  grep -q 'install -o root -g root -m 600 "\$tmp" "\$HIVE_ENV_FILE"' "$PROV/steps.sh"

expect "the written digest is read back off disk before the run continues" \
  grep -q 'written="\$(sed -n .s/\^HIVE_AUTH_TOKEN_SHA256=//p. "\$HIVE_ENV_FILE")"' "$PROV/steps.sh"

expect "an invalid written digest fails the step loudly" \
  grep -q 'die TOKEN_GENERATION_FAILED' "$PROV/steps.sh"

# emit_secret must put the secret on stdout only. This is the property that
# keeps a rotated token out of /var/lib/hive/provision.log.ndjson.
secret_out="$(HIVE_VAR_DIR="$WORK/var" HIVE_LOG_FILE="$WORK/var/log.ndjson" bash -c '
  mkdir -p "$HIVE_VAR_DIR"
  # shellcheck disable=SC1090
  source "$1"
  emit_secret "\"step\":\"generate_token\",\"data\":{\"accessToken\":\"S3CRET-VALUE\"}" \
              "\"step\":\"generate_token\",\"data\":{\"accessToken\":\"[redacted]\"}"
' _ "$PROV/lib.sh")"
if grep -q 'S3CRET-VALUE' <<<"$secret_out" && ! grep -q 'S3CRET-VALUE' "$WORK/var/log.ndjson" \
   && grep -q '\[redacted\]' "$WORK/var/log.ndjson"; then
  pass "emit_secret writes the plaintext to stdout and a redacted copy to the log"
else
  fail "emit_secret leaked the plaintext to the log file (or dropped it from stdout)"
  printf 'stdout: %s\nlog: %s\n' "$secret_out" "$(cat "$WORK/var/log.ndjson")"
fi

# The token must be freshly generated on every run: the plaintext cannot be
# recovered from a resumed one.
refute "the token digest is never read back out of the environment file to reuse it" \
  grep -q 'HIVE_AUTH_TOKEN_SHA256="\$(sed' "$PROV/steps.sh"

# ---------------------------------------------------------------------------
# 5. Framework behaviour the resumability guarantees rest on
# ---------------------------------------------------------------------------

for step in probe_env verify_auth firewall_rule; do
  expect "'$step' re-runs on every invocation" \
    grep -q "guard_$step() { return 1; }" "$PROV/steps.sh"
done
for step in generate_token write_secrets; do
  expect "'$step' re-runs for installs and skips updates" \
    grep -q "guard_$step() { \\[ \"\${OPT_UPDATE:-0}\" = 1 \\]; }" "$PROV/steps.sh"
done

expect "the completion step is last, after authenticated health verification" \
  bash -c 'tail="$(sed -n "/^STEPS=(/,/^)/p" "$1" | tr "\n" " ")"
           [[ "$tail" == *"health_check verify_auth complete_install"* ]]' _ "$PROV/main.sh"
expect "the completion marker is written atomically by the final step" \
  bash -c 'sed -n "/^step_complete_install()/,/^}/p" "$1" |
             grep -q "atomic_state_marker.*HIVE_INSTALL_COMPLETE_MARKER"' _ "$PROV/steps.sh"

rerun_out="$(HIVE_VAR_DIR="$WORK/rerun" HIVE_LOG_FILE="$WORK/rerun/log.ndjson" bash -c '
  mkdir -p "$HIVE_VAR_DIR/state"
  # shellcheck disable=SC1090
  source "$1"
  STEPS_PLANNED=(always cached)
  step_always() { :; }
  guard_always() { return 1; }
  step_cached() { :; }
  mark_step always ok
  mark_step cached ok
  run_step always
  run_step cached
' _ "$PROV/lib.sh")"
if grep -q '"step":"always","status":"start"' <<<"$rerun_out" &&
   grep -q '"step":"cached","status":"skip"' <<<"$rerun_out"; then
  pass "a recorded step is skipped, and a failing guard overrides its marker"
else
  fail "run_step did not honour markers and guards"
  printf '%s\n' "$rerun_out"
fi

# Bootstrap failures happen before CURRENT_STEP is set. They still need a typed
# terminal event so a client can render an actionable retry state.
set +e
terminal_event="$(HIVE_VAR_DIR="$WORK/term" HIVE_LOG_FILE="$WORK/term/log.ndjson" bash -c '
  mkdir -p "$HIVE_VAR_DIR/state"
  # shellcheck disable=SC1090
  source "$1"
  RUN_ID="contract"
  die CONCURRENT_RUN "another provision run holds the lock"
' _ "$PROV/lib.sh" 2>/dev/null)"
terminal_rc=$?
set -e
if [ "$terminal_rc" != 0 ] && grep -q \
  '"event":"run_end","status":"error","errorCode":"CONCURRENT_RUN","detail":"another provision run holds the lock"' \
  <<<"$terminal_event"; then
  pass "bootstrap failures emit a typed terminal event"
else
  fail "bootstrap failure did not emit a typed run_end event"
  printf '%s\n' "$terminal_event"
fi

# NDJSON must survive whatever apt and curl put on their output streams.
escaped="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"
  json_escape "$(printf "quote:\" back\\\\slash tab:\ttext\r\n\033[31mred\033[0m")"
' _ "$PROV/lib.sh")"
if [ -z "${escaped//[!$'\x01'-$'\x1f']/}" ] && [[ "$escaped" == *'\"'* ]] && [[ "$escaped" == *'\t'* ]]; then
  pass "json_escape produces control-character-free, quoted output"
else
  fail "json_escape left invalid JSON content: $escaped"
fi

# ---------------------------------------------------------------------------
# 6. Configurable install directory, data directory and port
# ---------------------------------------------------------------------------
#
# A configurable path that some check still hardcodes is worse than no option
# at all: the install succeeds and the check silently inspects the wrong place.

hardcoded="$(grep -nE '"/opt/hive|/home/hive/\.hive' "$CODE" \
  | grep -vE 'HIVE_(INSTALL|DATA)_DIR_DEFAULT=' || true)"
if [ -z "$hardcoded" ]; then
  pass "the install and data directories appear only as their declared defaults"
else
  fail "hardcoded install/data paths outside the default declarations: $hardcoded"
fi

# `source` both fragments and drive the real functions: this is the only way to
# prove the derived paths actually follow the options, rather than that the
# right words appear in the file.
paths_out="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  OPT_INSTALL_DIR=/srv/hive-app
  OPT_DATA_DIR=/mnt/big/hive-data
  OPT_PORT=9999
  OPT_ALLOWED_HOST=server.example.com
  HIVE_VERSION=0.0.0-test
  HIVE_AUTH_TOKEN_SHA256=deadbeef
  resolve_paths
  printf "opt=%s data=%s runtime=%s node=%s uninstall=%s\n" \
    "$HIVE_OPT" "$HIVE_DATA_DIR" "$HIVE_RUNTIME_DIR" "$HIVE_NODE_BIN" "$HIVE_UNINSTALL_SCRIPT"
  echo "--unit--"; hive_unit
  echo "--env--"; hive_env_base
  echo "--uninstall--"; hive_uninstall_script
' _ "$PROV/lib.sh" "$PROV/steps.sh")"

# Pinning the managed key names makes a future addition stop here until its
# author chooses a backend default or an explicit config migration. Values and
# ordering remain free to change.
managed_env_keys="$(sed -n '/^--env--$/,/^--uninstall--$/p' <<<"$paths_out" \
  | sed '1d;$d' | sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p' | sort)"
expected_managed_env_keys="$(printf '%s\n' \
  AGENT_BROWSER_ARGS AGENT_BROWSER_SOCKET_DIR DATA_DIR HIVE_ALLOWED_HOSTS HIVE_ALLOWED_ORIGINS \
  HIVE_AUTH_TOKEN_SHA256 HIVE_AUTOMATION_TIMEOUT_SEC HIVE_UPDATE_METHOD \
  HOME HOST NODE_ENV PATH PORT)"
expect "managed hive.env key changes require an explicit update decision" \
  test "$managed_env_keys" = "$expected_managed_env_keys"
expect "the service uses a browser socket directory owned by the hive account" \
  grep -q '^AGENT_BROWSER_SOCKET_DIR=/home/hive/.agent-browser$' <<<"$paths_out"
expect "service-account commands override an inherited browser socket directory" \
  bash -c 'sed -n "/^as_hive()/,/^}/p" "$1" |
             grep -q "AGENT_BROWSER_SOCKET_DIR=\"\\\$HIVE_HOME/.agent-browser\""' \
    _ "$PROV/steps.sh"

# A step that creates the install directory without stamping the marker first
# makes the install unresumable: the next run sees a directory it did not
# record creating and refuses it as a foreign occupant. The chaos lane caught
# this once; this keeps it caught.
claims="$(grep -cE 'install -d[^"]*"\$HIVE_OPT"' "$PROV/steps.sh" || true)"
if [ "$claims" = 1 ]; then
  pass "the install directory is only ever created through claim_install_dir"
else
  fail "\$HIVE_OPT is created in $claims places; it must only be created by claim_install_dir"
fi
expect "every step that writes under the install directory claims it first" \
  bash -c 'for s in install_node install_release write_uninstall; do
             sed -n "/^step_$s()/,/^}/p" "$1" | grep -q claim_install_dir || exit 1
           done' _ "$PROV/steps.sh"

identity_out="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  HIVE_ETC_DIR="$3/etc"
  HIVE_INSTALL_MARKER="$HIVE_ETC_DIR/.hive-install"
  HIVE_INSTALL_COMPLETE_MARKER="$HIVE_ETC_DIR/.hive-install-complete"
  HIVE_ENV_FILE="$HIVE_ETC_DIR/hive.env"
  OPT_PORT=9420
  OPT_INSTALL_DIR="$3/opt/hive"
  OPT_DATA_DIR="$3/home/hive/.hive"
  resolve_paths
  mkdir -p "$HIVE_ETC_DIR"

  install_identity_state; echo "none=$HIVE_INSTALL_STATE"
  claim_install_dir
  echo "manifest=$(tr "\n" "," <"$HIVE_INSTALL_MARKER")"
  echo "mode=$(stat -c %a "$HIVE_INSTALL_MARKER")"
  before="$(sha256sum "$HIVE_INSTALL_MARKER")"
  claim_install_dir
  after="$(sha256sum "$HIVE_INSTALL_MARKER")"
  [ "$before" = "$after" ] && echo immutable
  install_identity_state; echo "exact=$HIVE_INSTALL_STATE"
  OPT_PORT=9421
  install_identity_state; echo "port=$HIVE_INSTALL_STATE"
  OPT_PORT=9420; HIVE_OPT="$3/opt/other"
  install_identity_state; echo "install=$HIVE_INSTALL_STATE"
  HIVE_OPT="$3/opt/hive"; HIVE_DATA_DIR="$3/data/other"
  install_identity_state; echo "data=$HIVE_INSTALL_STATE"
  HIVE_DATA_DIR="$3/home/hive/.hive"
  atomic_state_marker "$HIVE_INSTALL_COMPLETE_MARKER" schema=1
  echo "complete-mode=$(stat -c %a "$HIVE_INSTALL_COMPLETE_MARKER")"
  install_identity_state; echo "complete=$HIVE_INSTALL_STATE"
  : >"$HIVE_INSTALL_MARKER"
  install_identity_state; echo "empty=$HIVE_INSTALL_STATE"
  rm -f "$HIVE_INSTALL_MARKER"
  install_identity_state; echo "orphan-complete=$HIVE_INSTALL_STATE"
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/identity")"

for state in none=none exact=incomplete port=mismatch install=mismatch data=mismatch \
             complete=complete empty=malformed orphan-complete=malformed; do
  expect "install identity state: $state" grep -qx "$state" <<<"$identity_out"
done
expect "the identity manifest contains only schema, port, install dir, and data dir" \
  grep -q 'manifest=schema=1,port=9420,install_dir=.*/opt/hive,data_dir=.*/home/hive/.hive,' \
    <<<"$identity_out"
expect "the identity manifest is mode 0644" grep -qx 'mode=644' <<<"$identity_out"
expect "the completion marker is mode 0644" grep -qx 'complete-mode=644' <<<"$identity_out"
expect "claim_install_dir never rewrites an existing identity manifest" \
  grep -qx immutable <<<"$identity_out"
refute "the install manifest is never sourced or evaluated" \
  grep -nE '(source|eval)[[:space:]].*HIVE_INSTALL_MARKER' "$CODE"
refute "the install manifest is never truncated" \
  grep -nE ':[[:space:]]*>[[:space:]]*"\$HIVE_INSTALL_MARKER"' "$CODE"

update_identity_out="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  HIVE_INSTALL_MARKER="$3/manifest"
  mkdir -p "$3"
  printf "schema=1\nport=9427\ninstall_dir=/srv/hive\ndata_dir=/mnt/hive-data\n" >"$HIVE_INSTALL_MARKER"
  OPT_UPDATE=1
  OPT_PORT=9420; OPT_INSTALL_DIR=""; OPT_DATA_DIR=""
  OPT_PORT_EXPLICIT=0; OPT_INSTALL_DIR_EXPLICIT=0; OPT_DATA_DIR_EXPLICIT=0
  apply_update_identity_defaults
  printf "auto=%s:%s:%s\n" "$OPT_PORT" "$OPT_INSTALL_DIR" "$OPT_DATA_DIR"
  OPT_PORT=9999; OPT_PORT_EXPLICIT=1
  apply_update_identity_defaults
  printf "explicit-port=%s\n" "$OPT_PORT"
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/update-identity")"
expect "update auto-detects the stored port and directories" \
  grep -qx 'auto=9427:/srv/hive:/mnt/hive-data' <<<"$update_identity_out"
expect "an explicit update option is not overwritten by auto-detection" \
  grep -qx 'explicit-port=9999' <<<"$update_identity_out"

ownership_out="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  HIVE_INSTALL_MARKER="$3/manifest"
  HIVE_INSTALL_COMPLETE_MARKER="$3/complete"
  HIVE_ENV_FILE="$3/hive.env"
  OPT_PORT=9420; HIVE_OPT=/opt/hive; HIVE_DATA_DIR=/home/hive/.hive
  mkdir -p "$3"
  printf "schema=1\nport=9420\ninstall_dir=/opt/hive\ndata_dir=/home/hive/.hive\n" >"$HIVE_INSTALL_MARKER"
  systemctl() { [ "$1:$2:$3" = "is-active:--quiet:hive" ]; }
  printf "PORT=9420\n" >"$HIVE_ENV_FILE"
  hive_service_owns_port && echo owned
  printf "PORT=9421\n" >"$HIVE_ENV_FILE"
  hive_service_owns_port || echo wrong-config
  read_hive_service_port() { return 1; }
  can_inspect_as_root() { return 1; }
  hive_service_port_unverifiable && echo unknown
  systemctl() { return 1; }
  hive_service_owns_port || echo inactive
  hive_service_port_unverifiable || echo inactive-not-unknown
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/ownership")"
for result in owned wrong-config unknown inactive inactive-not-unknown; do
  expect "busy-port ownership: $result" grep -qx "$result" <<<"$ownership_out"
done

unknown_port="$(HIVE_LOG_FILE="$WORK/unknown-port.log" bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  HIVE_INSTALL_MARKER="$3/manifest"
  HIVE_INSTALL_COMPLETE_MARKER="$3/complete"
  OPT_PORT=9420; HIVE_OPT=/opt/hive; HIVE_DATA_DIR=/home/hive/.hive
  mkdir -p "$3"
  printf "schema=1\nport=9420\ninstall_dir=/opt/hive\ndata_dir=/home/hive/.hive\n" >"$HIVE_INSTALL_MARKER"
  port_in_use() { return 0; }
  systemctl() { [ "$1:$2:$3" = "is-active:--quiet:hive" ]; }
  read_hive_service_port() { return 1; }
  can_inspect_as_root() { return 1; }
  preflight_port
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/unknown-port")"
expect "unprivileged busy-port ownership is a non-blocking unknown warning" \
  grep -q '"check":"port","status":"warn".*"heldByHive":null' <<<"$unknown_port"

inactive_port="$(HIVE_LOG_FILE="$WORK/inactive-port.log" bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  HIVE_INSTALL_MARKER="$3/manifest"
  HIVE_INSTALL_COMPLETE_MARKER="$3/complete"
  OPT_PORT=9420; HIVE_OPT=/opt/hive; HIVE_DATA_DIR=/home/hive/.hive
  mkdir -p "$3"
  printf "schema=1\nport=9420\ninstall_dir=/opt/hive\ndata_dir=/home/hive/.hive\n" >"$HIVE_INSTALL_MARKER"
  port_in_use() { return 0; }
  systemctl() { return 1; }
  can_inspect_as_root() { return 1; }
  preflight_port
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/inactive-port")"
expect "an inactive Hive service never exempts a foreign busy listener" \
  grep -q '"check":"port","status":"fail".*"heldByHive":false.*"errorCode":"PORT_IN_USE"' \
    <<<"$inactive_port"

identity_preflight="$(HIVE_LOG_FILE="$WORK/identity-preflight.log" bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  HIVE_INSTALL_MARKER="$3/manifest"
  HIVE_INSTALL_COMPLETE_MARKER="$3/complete"
  HIVE_NODE_BIN="$3/node"
  OPT_PORT=9420; HIVE_OPT=/opt/hive; HIVE_DATA_DIR=/home/hive/.hive
  mkdir -p "$3"
  printf "#!/bin/sh\nprintf \"%%s\\\\n\" \"%s.0.0-test\"\n" "${NODE_VERSION%%.*}" >"$HIVE_NODE_BIN"
  chmod +x "$HIVE_NODE_BIN"
  update_runtime_matches_target && echo runtime-update-compatible
  guard_install_node || echo runtime-install-required
  printf "schema=1\nport=9420\ninstall_dir=/opt/hive\ndata_dir=/home/hive/.hive\n" >"$HIVE_INSTALL_MARKER"
  printf "schema=1\n" >"$HIVE_INSTALL_COMPLETE_MARKER"
  preflight_existing_install
  OPT_UPDATE=1
  preflight_existing_install
  printf "#!/bin/sh\nprintf \"%%s\\\\n\" \"0.0.0-test\"\n" >"$HIVE_NODE_BIN"
  preflight_existing_install
  OPT_UPDATE=0
  rm -f "$HIVE_INSTALL_COMPLETE_MARKER"
  OPT_PORT=9421
  preflight_existing_install
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/identity-preflight")"
expect "completed preflight uses ALREADY_INSTALLED" \
  grep -q '"check":"existing_install","status":"fail".*"errorCode":"ALREADY_INSTALLED"' \
    <<<"$identity_preflight"
expect "update accepts a completed installation on an older runtime from the same major" \
  grep -q '"check":"existing_install","status":"ok".*can update' <<<"$identity_preflight"
expect "an older runtime from the target major is update-compatible" \
  grep -q '^runtime-update-compatible$' <<<"$identity_preflight"
expect "a compatible runtime patch is still installed to reach the exact target version" \
  grep -q '^runtime-install-required$' <<<"$identity_preflight"
expect "update preflight rejects a private runtime change" \
  grep -q '"check":"existing_install","status":"fail".*"errorCode":"UPDATE_RUNTIME_MISMATCH"' \
    <<<"$identity_preflight"
expect "mismatched preflight uses INSTALL_IDENTITY_MISMATCH" \
  grep -q '"check":"existing_install","status":"fail".*"errorCode":"INSTALL_IDENTITY_MISMATCH"' \
    <<<"$identity_preflight"

expect "the runtime follows --install-dir" \
  grep -q 'runtime=/srv/hive-app/runtime node=/srv/hive-app/runtime/current/bin/node' <<<"$paths_out"
expect "the uninstall script is written inside the install directory" \
  grep -q 'uninstall=/srv/hive-app/hive-uninstall.sh' <<<"$paths_out"
expect "the systemd unit runs the release from the configured install directory" \
  grep -q 'WorkingDirectory=/srv/hive-app/current' <<<"$paths_out"
expect "the systemd unit can write the configured data directory" \
  grep -q 'ReadWritePaths=.*/mnt/big/hive-data' <<<"$paths_out"
expect "the backend is told to use the configured data directory" \
  grep -q '^DATA_DIR=/mnt/big/hive-data' <<<"$paths_out"
expect "the backend is told to use the configured port" grep -q '^PORT=9999' <<<"$paths_out"
expect "the backend allows the address selected by the client" \
  grep -q '^HIVE_ALLOWED_HOSTS=server.example.com' <<<"$paths_out"

fw_open="$(HIVE_LOG_FILE="$WORK/preflight.log.ndjson" bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  firewall_backend() { printf ufw; }
  firewall_active() { return 0; }
  sudo_nopasswd() { return 0; }
  OPT_PORT=9999
  preflight_firewall
' _ "$PROV/lib.sh" "$PROV/steps.sh")"

expect "an active ufw reports the automatic port rule" \
  grep -q '"check":"firewall","status":"ok".*"ruleToApply":"ufw allow 9999/tcp"' <<<"$fw_open"

nft_service_detection="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  mkdir -p "$3/bin"
  LOG_FILE="$3/preflight.log"
  printf "#!/bin/sh\nprintf \"table ip filter {}\\\\n\"\n" >"$3/bin/nft"
  chmod +x "$3/bin/nft"
  PATH="$3/bin:$PATH"
  OPT_PORT=9420
  firewalld_is_active() { return 1; }
  ufw_is_active() { return 1; }
  sudo_nopasswd() { return 0; }
  systemctl() { return 1; }
  nftables_is_active && echo inactive-ruleset-active || echo inactive-ruleset-ignored
  preflight_firewall
  systemctl() { [ "$1:$2:$3" = "is-active:--quiet:nftables" ]; }
  nftables_is_active && echo active-service-detected
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/nft-service")"
expect "generated nftables rules are ignored when the nftables service is inactive" \
  grep -qx inactive-ruleset-ignored <<<"$nft_service_detection"
expect "preflight accepts generated rules when the nftables service is inactive" \
  grep -q '"check":"firewall","status":"ok".*"active":false' <<<"$nft_service_detection"
expect "the active nftables system service is detected" \
  grep -qx active-service-detected <<<"$nft_service_detection"

raw_nft="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  firewalld_is_active() { return 1; }
  ufw_is_active() { return 1; }
  nftables_is_active() { return 0; }
  firewall_backend
' _ "$PROV/lib.sh" "$PROV/steps.sh")"
expect "an inactive ufw installation cannot hide the active nftables service" \
  [ "$raw_nft" = nftables ]

fw_unsupported="$(HIVE_LOG_FILE="$WORK/preflight.log.ndjson" bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  firewall_backend() { printf nftables; }
  firewall_active() { return 0; }
  sudo_nopasswd() { return 0; }
  OPT_PORT=9999
  preflight_firewall
' _ "$PROV/lib.sh" "$PROV/steps.sh")"
expect "an active unsupported firewall blocks preflight" \
  grep -q '"check":"firewall","status":"fail".*"errorCode":"FIREWALL_RULE_FAILED"' \
    <<<"$fw_unsupported"

# ---------------------------------------------------------------------------
# 7. The generated uninstall script
# ---------------------------------------------------------------------------

uninstall="$WORK/hive-uninstall.sh"
sed -n '/^--uninstall--$/,$p' <<<"$paths_out" | tail -n +2 >"$uninstall"

expect "the generated uninstaller parses" bash -n "$uninstall"
expect "it carries the real install directory" grep -q 'rm -rf "/srv/hive-app"' "$uninstall"
expect "it removes the configuration" grep -q 'rm -rf "/etc/hive"' "$uninstall"
expect "it removes the provisioning state" grep -q 'rm -rf "/var/lib/hive"' "$uninstall"
expect "it removes the service unit" grep -q 'rm -f "/etc/systemd/system/hive.service"' "$uninstall"
expect "it removes the service account" grep -q 'userdel' "$uninstall"
expect "it removes only the firewall rule this install recorded" \
  grep -q 'ufw delete \$spec' "$uninstall"
expect "it removes the data directory only under --purge" \
  bash -c 'grep -A3 "purge\" = 1" "$1" | grep -q "rm -rf \"/mnt/big/hive-data\""' _ "$uninstall"

refute "it never removes system packages" grep -nE 'apt-get (remove|purge)|dpkg -r' "$uninstall"
refute "it never removes package repositories" \
  grep -nE '/etc/apt/sources\.list|/etc/apt/keyrings' "$uninstall"
refute "it never enables, disables or resets the firewall" \
  grep -nE 'ufw (enable|disable|reset|default)' "$uninstall"

# The uninstaller deletes the directory it is being read from. bash reads a
# script incrementally, so the body must be parsed in full before the first
# deletion — the same wrapper trick build.sh uses for the download.
expect "the uninstaller body is wrapped in a function called on the last line" \
  bash -c 'grep -q "^__hive_uninstall() {" "$1" && tail -1 "$1" | grep -q "^__hive_uninstall"' _ "$uninstall"

purge_free="$(bash -c 'sed -n "1,/purge\" = 1/p" "$1" | grep -c "mnt/big/hive-data" || true' _ "$uninstall")"
expect "the data directory is untouched before the --purge branch" [ "$purge_free" = 0 ]

# ---------------------------------------------------------------------------
# 8. Preflight reports and changes nothing
# ---------------------------------------------------------------------------

bash "$PROV/build.sh" 9.9.9-contract >/dev/null
bundle="$PROV/dist/provision.sh"

# No `die` may be reachable from the preflight path: a check that found
# something is a finding, and the run still exits 0.
preflight_body="$(sed -n '/^run_preflight()/,/^}/p;/^preflight_[a-z_]*()/,/^}/p' "$PROV/steps.sh")"
if grep -qE '\bdie [A-Z_]+' <<<"$preflight_body"; then
  fail "a preflight check calls die; preflight must report, not decide"
else
  pass "no preflight check can abort the run"
fi

refute "preflight never runs bootstrap, so it creates no directory and takes no lock" \
  bash -c 'sed -n "/OPT_PREFLIGHT\" = 1/,/^  fi/p" "$1" | grep -qE "\bbootstrap\b|mkdir"' _ "$PROV/main.sh"

pre_out="$WORK/preflight.ndjson"
if bash "$bundle" --preflight --port 9420 >"$pre_out" 2>"$WORK/preflight.err"; then
  pass "preflight exits 0"
else
  fail "preflight exited non-zero: $(cat "$WORK/preflight.err")"
fi
for check in os systemd arch privilege existing_install port install_dir data_dir firewall; do
  expect "preflight reports the '$check' check" \
    grep -q "\"check\":\"$check\"" "$pre_out"
done
expect "preflight ends with a summary and a clean terminal event" \
  bash -c 'grep -q "\"event\":\"preflight\",\"ok\":" "$1" && grep -q "\"event\":\"run_end\",\"status\":\"ok\"" "$1"' _ "$pre_out"

# Every errorCode preflight can name must be one the taxonomy declares, or a
# client would render a blocker it has no hint for. A clean host reports no
# findings at all, so an empty grep is a pass, not an errexit abort.
pre_codes="$(grep -ohE '"errorCode":"[A-Z_]+"' "$pre_out" | cut -d'"' -f4 | sort -u || true)"
undeclared_pre="$(comm -23 <(printf '%s\n' "$pre_codes") <(printf '%s\n' "$ts_codes") | grep -v '^$' || true)"
if [ -z "$undeclared_pre" ]; then
  pass "preflight findings name only declared error codes"
else
  fail "preflight named undeclared codes: $undeclared_pre"
fi

# ---------------------------------------------------------------------------
# 9. Service-account SSH access
# ---------------------------------------------------------------------------

key_out="$(bash -c '
  # shellcheck disable=SC1090
  source "$1"; source "$2"
  ed="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB1KcYHkFOVWvKt0FVWQ4hQEXAMPLEKEYBASE64x"
  ssh_key_valid "$ed home-laptop" && echo "valid-ed25519"
  ssh_key_valid "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC test" && echo "valid-rsa"
  ssh_key_valid "not-a-key at all" || echo "rejects-garbage"
  ssh_key_valid "rm -rf /" || echo "rejects-command"
  HIVE_AUTHORIZED_KEYS="$3"
  printf "%s existing-key\n" "$ed" >"$HIVE_AUTHORIZED_KEYS"
  printf "ssh-ed25519 AAAAsomeoneelseskey handwritten\n" >>"$HIVE_AUTHORIZED_KEYS"
  authorized_key_present "$ed a-different-comment" && echo "matches-ignoring-comment"
  authorized_key_present "ssh-ed25519 AAAAnotpresent x" || echo "misses-absent-key"
' _ "$PROV/lib.sh" "$PROV/steps.sh" "$WORK/authorized_keys")"

for want in valid-ed25519 valid-rsa rejects-garbage rejects-command \
            matches-ignoring-comment misses-absent-key; do
  expect "authorized-keys handling: $want" grep -qx "$want" <<<"$key_out"
done

expect "the key is appended, never rewritten" \
  grep -q 'printf .%s\\n. "\$OPT_SSH_KEY" >>"\$HIVE_AUTHORIZED_KEYS"' "$PROV/steps.sh"
refute "authorized_keys is never truncated or overwritten" \
  grep -nE '[^>]>[[:space:]]*"\$HIVE_AUTHORIZED_KEYS"' "$CODE"

# ---------------------------------------------------------------------------
# 10. The bundle: version validation, truncation safety, shellcheck
# ---------------------------------------------------------------------------

refute "build.sh rejects an unsafe version string" bash "$PROV/build.sh" '1.2.3";id'

bash "$PROV/build.sh" 9.9.9-contract >/dev/null
bundle="$PROV/dist/provision.sh"
expect "the generated bundle parses" bash -n "$bundle"

# A truncated download must be a syntax error, not a partial install.
truncated="$WORK/truncated.sh"
head -c "$(( $(wc -c <"$bundle") / 2 ))" "$bundle" >"$truncated"
refute "a truncated bundle fails to parse and executes nothing" bash "$truncated"

expect "the bundle prints help without root" bash "$bundle" --help
expect "the bundle accepts --update as an explicit mode" bash "$bundle" --update --help
refute "the bundle rejects an out-of-range port" bash "$bundle" --port 99999
refute "the bundle rejects an unknown option" bash "$bundle" --nope
refute "the bundle rejects an allowed host that could be read as an option" \
  bash "$bundle" --allowed-host '-oProxyCommand=bad'
refute "an update cannot change the allowed host" \
  bash "$bundle" --update --allowed-host server.example.com
refute "an update cannot add an SSH key" \
  bash "$bundle" --update --ssh-public-key \
    'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIH5Yk3xQ9v0mZ1n2ZQ8yq3Kx7bR4tV6wN8pL0aS2dF3g'

# --release-file is a dev/test affordance: a prerelease bundle parses it, a
# stable bundle refuses it — a stable install must never sideload a release.
expect "--release-file is parsed by a prerelease bundle" \
  bash "$bundle" --release-file /var/lib/hive/uploads/x.tar.gz --help
refute "--release-file rejects a path that could escape quoting" \
  bash "$bundle" --release-file '/tmp/x;rm -rf /.tar.gz'
bash "$PROV/build.sh" 9.9.9 >/dev/null
stable_out="$(bash "$bundle" --release-file /var/lib/hive/uploads/x.tar.gz 2>/dev/null || true)"
expect "--release-file is refused for stable script versions" \
  grep -q '"errorCode":"RELEASE_DOWNLOAD_FAILED"' <<<"$stable_out"
bash "$PROV/build.sh" 9.9.9-contract >/dev/null

if command -v shellcheck >/dev/null 2>&1; then
  expect "shellcheck is clean on the sources and the bundle" \
    shellcheck "$PROV/build.sh" "$PROV/lib.sh" "$PROV/steps.sh" "$PROV/main.sh" "$bundle" \
      "$ROOT/test/provision/contract.sh" "$ROOT/test/provision/e2e-docker.sh"
else
  echo "skip shellcheck (not installed)"
fi

if [ "$FAILURES" -ne 0 ]; then
  echo "$FAILURES failing case(s)" >&2
  exit 1
fi
echo "all provision contracts hold"
