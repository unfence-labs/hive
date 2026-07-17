#!/usr/bin/env bash
# Contract test: the bash error taxonomy (lib.sh SETUP_ERROR_CODES) must be
# identical to shared/setup-errors.ts SETUP_ERROR_CODES.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Extract the bash list.
bash_codes="$(
  # shellcheck source=/dev/null
  . "$ROOT/scripts/provision/lib.sh" 2>/dev/null
  printf '%s\n' $SETUP_ERROR_CODES | sort
)" || true
# lib.sh runs `set -e`/traps on source; re-extract robustly if the above bailed.
bash_codes="$(grep -A6 'SETUP_ERROR_CODES="' "$ROOT/scripts/provision/lib.sh" \
  | tr ' \\\n"' '\n' | grep -E '^[A-Z_]+$' | sort -u)"

ts_codes="$(grep -oE '"[A-Z_]+"' "$ROOT/shared/setup-errors.ts" \
  | tr -d '"' | grep -E '^[A-Z_]+$' | sort -u)"
# Drop the const name if it leaked in.
ts_codes="$(printf '%s\n' "$ts_codes" | grep -v '^SETUP_ERROR_CODES$' || true)"

if diff <(printf '%s\n' "$bash_codes") <(printf '%s\n' "$ts_codes") >/tmp/codes.diff; then
  echo "OK: bash and TS error taxonomies match ($(wc -w <<<"$bash_codes") codes)"
else
  echo "FAIL: error taxonomy mismatch (< bash, > TS):"
  cat /tmp/codes.diff
  exit 1
fi
