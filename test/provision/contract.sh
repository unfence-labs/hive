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
# name the thing that departed.
CODE="$WORK/provision-code.txt"
grep -hv '^[[:space:]]*#' "$PROV"/lib.sh "$PROV"/steps.sh "$PROV"/main.sh >"$CODE"

# ---------------------------------------------------------------------------
# 1. The bash and TypeScript error taxonomies stay in sync
# ---------------------------------------------------------------------------

bash_codes="$(sed -n '/^SETUP_ERROR_CODES="/,/"$/p' "$PROV/lib.sh" \
  | tr ' \\"' '\n' | grep -E '^[A-Z_]+$' | grep -v '^SETUP_ERROR_CODES$' | sort -u)"
ts_codes="$(sed -n '/^export const SETUP_ERROR_CODES = \[/,/^\] as const;/p' \
  "$ROOT/shared/setup-errors.ts" | grep -oE '"[A-Z_]+"' | tr -d '"' | sort -u)"

[ -n "$bash_codes" ] || { echo "FAIL: could not extract SETUP_ERROR_CODES from lib.sh"; exit 1; }
[ -n "$ts_codes" ] || { echo "FAIL: could not extract SETUP_ERROR_CODES from setup-errors.ts"; exit 1; }

diff_out="$(diff <(printf '%s\n' "$bash_codes") <(printf '%s\n' "$ts_codes") || true)"
if [ -z "$diff_out" ]; then
  pass "bash and TypeScript declare the same $(wc -w <<<"$bash_codes" | tr -d ' ') error codes"
else
  fail "SETUP_ERROR_CODES differ between lib.sh and shared/setup-errors.ts:"
  printf '%s\n' "$diff_out"
fi

# Every code the script can actually emit must be declared. This is the check
# that catches a typo in a `die` call, which would otherwise reach a client as
# an unknown error only at failure time.
emitted="$( { grep -ohE '\bdie [A-Z_]+' "$PROV"/*.sh | awk '{print $2}'
              grep -ohE '\bSTEP_ERR_CODE=[A-Z_]+' "$PROV"/*.sh | cut -d= -f2
            } | sort -u)"
undeclared="$(comm -23 <(printf '%s\n' "$emitted") <(printf '%s\n' "$bash_codes"))"
if [ -z "$undeclared" ]; then
  pass "every die/STEP_ERR_CODE code is declared in the taxonomy"
else
  fail "codes emitted by the script but not declared: $(tr '\n' ' ' <<<"$undeclared")"
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

refute "Tailscale is a prerequisite the operator arranges, not something this installs" \
  grep -niE 'tailscale|ts_authkey' "$CODE"

refute "the firewall is left untouched" grep -niE '\bufw\b|iptables|\bnft\b' "$CODE"

refute "the development port 3000 does not appear in the provisioner" \
  grep -nE '\b3000\b' "$CODE"

expect "the Node runtime is installed inside Hive's own install directory" \
  grep -q 'HIVE_RUNTIME_DIR="\$HIVE_OPT/runtime"' "$PROV/steps.sh"

expect "the default port is the production port 9420" \
  grep -q 'OPT_PORT="\${HIVE_PORT:-9420}"' "$PROV/main.sh"

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

for step in generate_token write_secrets verify_auth; do
  expect "'$step' re-runs on every invocation" \
    grep -q "guard_$step() { return 1; }" "$PROV/steps.sh"
done

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
# 6. The bundle: version validation, truncation safety, shellcheck
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
refute "the bundle rejects an out-of-range port" bash "$bundle" --port 99999
refute "the bundle rejects an unknown option" bash "$bundle" --nope

bash "$PROV/build.sh" 9.9.9 >/dev/null
refute "--release-file is refused for non-prerelease script versions" \
  bash "$bundle" --release-file /tmp/does-not-exist

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
