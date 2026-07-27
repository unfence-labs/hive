#!/usr/bin/env bash
# Guard tests for scripts/release/build-backend-tarball.sh.
# Only the argument and host checks are exercised: they all reject before the
# build starts, so this suite runs in a second and needs no toolchain.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$ROOT/scripts/release/build-backend-tarball.sh"
FAILURES=0
NODE_SHIM=""

case "$(uname -m)" in
  x86_64) HOST_ARCH=x64 ;;
  aarch64|arm64) HOST_ARCH=arm64 ;;
  *) echo "unsupported test host: $(uname -m)" >&2; exit 2 ;;
esac
FOREIGN_ARCH=arm64
[ "$HOST_ARCH" = arm64 ] && FOREIGN_ARCH=x64

# Asserts that the script exits 2 with a message naming the reason, and that it
# wrote nothing to its output directory.
expect_rejected() {
  local label="$1" fragment="$2" out_dir out status
  shift 2
  out_dir="$(mktemp -d)"
  rmdir "$out_dir"
  out="$(PATH="$NODE_SHIM${NODE_SHIM:+:}$PATH" OUT_DIR="$out_dir" bash "$SCRIPT" "$@" 2>&1)" && status=0 || status=$?
  if [ "$status" -eq 2 ] && [[ "$out" == *"$fragment"* ]] && [ ! -e "$out_dir" ]; then
    echo "ok   $label"
  else
    echo "FAIL $label: exit $status (expected 2), looking for '$fragment' in:"
    echo "$out"
    FAILURES=$((FAILURES + 1))
  fi
}

expect_rejected "rejects a non-semantic version" "invalid semantic version" 1.0
expect_rejected "rejects a leading-zero version" "invalid semantic version" 1.0.01
expect_rejected "rejects an unknown architecture" "unsupported release architecture" 1.0.0 mips
expect_rejected "rejects a cross-architecture build" \
  "must be built on a linux-$FOREIGN_ARCH host" 1.0.0 "$FOREIGN_ARCH"

# A Node whose major does not match the pinned one would compile the native
# modules against an ABI the provisioned runtime cannot load.
NODE_SHIM="$(mktemp -d)"
cat >"$NODE_SHIM/node" <<'EOF'
#!/usr/bin/env bash
echo 99
EOF
chmod +x "$NODE_SHIM/node"

expect_rejected "rejects a mismatched Node major" "must run on Node" 1.0.0 "$HOST_ARCH"
# A prerelease version is valid input: it must reach the Node check rather than
# be rejected as malformed.
expect_rejected "accepts a prerelease version" "must run on Node" 1.0.0-rc.1 "$HOST_ARCH"

if [ "$FAILURES" -ne 0 ]; then
  echo "$FAILURES failing case(s)" >&2
  exit 1
fi
echo "all release build guards pass"
