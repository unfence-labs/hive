#!/usr/bin/env bash
# Contract test: the bash error taxonomy (lib.sh SETUP_ERROR_CODES) must be
# identical to shared/setup-errors.ts SETUP_ERROR_CODES.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Extract the full (possibly line-continued) assignment, then keep the codes.
bash_codes="$(sed -n '/^SETUP_ERROR_CODES="/,/"$/p' "$ROOT/scripts/provision/lib.sh" \
  | tr ' \\"' '\n' | grep -E '^[A-Z_]+$' | grep -v '^SETUP_ERROR_CODES$' | sort -u)"

ts_codes="$(grep -oE '"[A-Z_]+"' "$ROOT/shared/setup-errors.ts" \
  | tr -d '"' | sort -u)"

[ -n "$bash_codes" ] || { echo "FAIL: could not extract SETUP_ERROR_CODES from lib.sh"; exit 1; }

diff_file="$(mktemp)"
trap 'rm -f "$diff_file"' EXIT
if diff <(printf '%s\n' "$bash_codes") <(printf '%s\n' "$ts_codes") >"$diff_file"; then
  echo "OK: bash and TS error taxonomies match ($(wc -w <<<"$bash_codes" | tr -d ' ') codes)"
else
  echo "FAIL: error taxonomy mismatch (< bash, > TS):"
  cat "$diff_file"
  exit 1
fi
