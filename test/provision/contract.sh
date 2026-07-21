#!/usr/bin/env bash
# Contract test: every error emitted by provision.sh must exist in the shared
# taxonomy. The shared list also contains SSH and guided-setup client errors.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Extract the full (possibly line-continued) assignment, then keep the codes.
bash_codes="$(sed -n '/^SETUP_ERROR_CODES="/,/"$/p' "$ROOT/scripts/provision/lib.sh" \
  | tr ' \\"' '\n' | grep -E '^[A-Z_]+$' | grep -v '^SETUP_ERROR_CODES$' | sort -u)"

ts_codes="$(grep -oE '"[A-Z_]+"' "$ROOT/shared/setup-errors.ts" \
  | tr -d '"' | sort -u)"

[ -n "$bash_codes" ] || { echo "FAIL: could not extract SETUP_ERROR_CODES from lib.sh"; exit 1; }

missing="$(comm -23 <(printf '%s\n' "$bash_codes") <(printf '%s\n' "$ts_codes"))"
if [ -n "$missing" ]; then
  echo "FAIL: provision errors missing from shared/setup-errors.ts:"
  printf '%s\n' "$missing"
  exit 1
fi

echo "OK: all $(wc -w <<<"$bash_codes" | tr -d ' ') provision error codes exist in the shared taxonomy"

grep -q 'tailscale up --auth-key="file:$SENSITIVE_FILE"' "$ROOT/scripts/provision/steps.sh"
grep -q 'unset TS_AUTHKEY' "$ROOT/scripts/provision/steps.sh"
if grep -Eq 'tailscale up .*TS_AUTHKEY' "$ROOT/scripts/provision/steps.sh"; then
  echo "FAIL: Tailscale secret appears directly in command arguments"
  exit 1
fi

if grep -Eq 'install_helpers|title_install_helpers' \
  "$ROOT/scripts/provision/main.sh" "$ROOT/scripts/provision/steps.sh"; then
  echo "FAIL: runtime root helpers are still provisioned"
  exit 1
fi
grep -q 'rm -rf /usr/lib/hive/helpers' "$ROOT/scripts/provision/steps.sh"
grep -q 'rm -f /etc/sudoers.d/hive' "$ROOT/scripts/provision/steps.sh"

if bash "$ROOT/scripts/provision/build.sh" '1.2.3";id' >/dev/null 2>&1; then
  echo "FAIL: provision build accepted an unsafe version"
  exit 1
fi

echo "OK: secret handling, privilege boundary, and version validation contracts hold"

# Bootstrap failures happen before CURRENT_STEP is set. They still need a typed
# terminal event so the frontend can render an actionable retry state.
tmp_dir="$(mktemp -d)"
set +e
terminal_event="$(HIVE_VAR_DIR="$tmp_dir" HIVE_LOG_FILE="$tmp_dir/provision.log" \
  bash -c '
    source "$1"
    mkdir -p "$HIVE_VAR_DIR/state"
    RUN_ID="contract"
    die CONCURRENT_RUN "another provision run holds the lock"
  ' _ "$ROOT/scripts/provision/lib.sh" 2>/dev/null)"
terminal_rc=$?
set -e
rm -rf "$tmp_dir"
[ "$terminal_rc" != 0 ] || { echo "FAIL: bootstrap error unexpectedly succeeded"; exit 1; }
grep -q '"event":"run_end","status":"error","errorCode":"CONCURRENT_RUN","detail":"another provision run holds the lock"' \
  <<<"$terminal_event" || {
    echo "FAIL: bootstrap error did not emit a typed run_end event"
    printf '%s\n' "$terminal_event"
    exit 1
  }

echo "OK: bootstrap failures emit typed terminal events"
