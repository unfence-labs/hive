#!/usr/bin/env bash
# Build a self-contained Hive backend release tarball:
#   hive-backend-<version>-linux-<arch>.tar.gz  containing dist/ + prod
#   node_modules + package.json, plus its SHA256.
# Used by the release CI and, locally, to feed provision.sh --release-file
# (set HIVE_DEV_RELEASE_TARBALL to the output for the OrbStack dev flow).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-0.0.0-dev}"
# No case-in-command-substitution and ASCII only below: macOS ships bash 3.2,
# whose parser chokes on both.
ARCH="${2:-}"
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "unsupported arch: $(uname -m)" >&2; exit 2 ;;
  esac
fi
OUT_DIR="${OUT_DIR:-$ROOT/dist-release}"
NAME="hive-backend-$VERSION-linux-$ARCH"

echo "Building $NAME..."
mkdir -p "$OUT_DIR"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# Build the backend and shared dep.
( cd "$ROOT" && npm ci --workspaces --include-workspace-root >/dev/null 2>&1 || npm install >/dev/null )
( cd "$ROOT/shared" && npm run build >/dev/null )
( cd "$ROOT/backend" && npm run build >/dev/null )

# Assemble: compiled output + package manifest, then install prod deps into it.
mkdir -p "$staging/pkg"
cp -r "$ROOT/backend/dist" "$staging/pkg/dist"
cp "$ROOT/backend/package.json" "$staging/pkg/package.json"
# Bundle the built shared package so its "@hive/shared/*" imports resolve.
mkdir -p "$staging/pkg/node_modules/@hive/shared"
cp -r "$ROOT/shared/dist" "$staging/pkg/node_modules/@hive/shared/dist"
cp "$ROOT/shared/package.json" "$staging/pkg/node_modules/@hive/shared/package.json"
# Target linux so platform-selected optional deps (sharp's @img/*) match the
# server even when building on macOS. node-pty has no linux prebuild in its
# npm package; provision.sh rebuilds it on the server when it cannot load.
( cd "$staging/pkg" && npm install --omit=dev --no-audit --no-fund \
    --os=linux --cpu="$ARCH" --libc=glibc >/dev/null 2>&1 )

tar -czf "$OUT_DIR/$NAME.tar.gz" -C "$staging/pkg" .
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
else
  ( cd "$OUT_DIR" && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )
fi
echo "-> $OUT_DIR/$NAME.tar.gz"
cat "$OUT_DIR/$NAME.tar.gz.sha256"
