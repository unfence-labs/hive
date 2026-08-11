#!/usr/bin/env bash
# Build a lockfile-pinned backend release tarball for one Linux architecture.
#
#   scripts/release/build-backend-tarball.sh [VERSION] [ARCH]
#
# Output: $OUT_DIR/hive-backend-<version>-linux-<arch>.tar.gz plus a .sha256
# sibling. Both names are derivable from the version and the architecture
# alone, so an installer can build the download URL without calling the API.
set -Eeuo pipefail

# node-pty has no Linux prebuild: it is compiled by node-gyp at install time
# against the ABI of the Node that runs this build. The runtime provisioned on
# the server is pinned to the same major, otherwise the addon will not load.
RELEASE_NODE_MAJOR=24

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-0.0.0-dev}"
ARCH="${2:-}"

if ! node "$ROOT/scripts/release/release-version.mjs" macos "$VERSION" >/dev/null 2>&1; then
  echo "invalid semantic version: $VERSION" >&2
  exit 2
fi

host_arch=""
case "$(uname -m)" in
  x86_64) host_arch=x64 ;;
  aarch64|arm64) host_arch=arm64 ;;
esac
ARCH="${ARCH:-$host_arch}"
case "$ARCH" in
  x64|arm64) : ;;
  *) echo "unsupported release architecture: ${ARCH:-$(uname -m)}" >&2; exit 2 ;;
esac

# Native modules are compiled here, so the build host must be the target host.
# npm's --os/--cpu flags only steer optional dependency selection (sharp); they
# do not cross-compile node-pty, which would silently ship a host-arch addon.
if [ "$(uname -s)" != Linux ] || [ "$ARCH" != "$host_arch" ]; then
  echo "linux-$ARCH releases must be built on a linux-$ARCH host (this is $(uname -s)/$(uname -m))" >&2
  echo "native modules are compiled during the build and cannot be cross-compiled" >&2
  exit 2
fi

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" != "$RELEASE_NODE_MAJOR" ]; then
  echo "this build must run on Node $RELEASE_NODE_MAJOR.x (found $(node -v))" >&2
  echo "native modules are compiled against the running Node ABI" >&2
  exit 2
fi

OUT_DIR="${OUT_DIR:-$ROOT/dist-release}"
NAME="hive-backend-$VERSION-linux-$ARCH"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

echo "Building $NAME..."
mkdir -p "$OUT_DIR"

# Build from the repository lockfile. Clean the output first so stale files
# from an earlier build cannot leak into the archive.
( cd "$ROOT" && npm ci --workspaces --include-workspace-root >/dev/null )
rm -rf "$ROOT/backend/dist" "$ROOT/shared/dist"
( cd "$ROOT/backend" && npm run build >/dev/null )

[ -f "$ROOT/backend/dist/index.js" ] || {
  echo "backend build produced no dist/index.js" >&2
  exit 1
}
if find "$ROOT/backend/dist" -type f \( -name '*.test.*' -o -name 'test-helpers.*' \) -print -quit | grep -q .; then
  echo "backend build contains test files" >&2
  exit 1
fi

# Recreate the workspace shape in an isolated directory, then let npm select
# production dependencies from the root lockfile. There is no standalone
# npm install and therefore no second dependency resolution.
install_root="$staging/install"
mkdir -p "$install_root/backend" "$install_root/shared"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$install_root/"
cp "$ROOT/backend/package.json" "$install_root/backend/"
cp "$ROOT/shared/package.json" "$install_root/shared/"
( cd "$install_root" && npm ci --omit=dev \
    --workspace @hive/backend --workspace @hive/shared \
    --include-workspace-root=false --os=linux --cpu="$ARCH" --libc=glibc \
    --no-audit --no-fund >/dev/null )

pkg="$staging/pkg"
mkdir -p "$pkg"
cp -R "$ROOT/backend/dist" "$pkg/dist"
cp -R "$install_root/node_modules" "$pkg/node_modules"
cp "$ROOT/LICENSE" "$pkg/"
# The runtime reads this file to answer GET /api/server/version when no
# explicit version is configured (manual PM2 installations configure one).
printf '%s\n' "$VERSION" >"$pkg/VERSION"

# The manifest carries the release version and the build facts an installer
# needs to reject a tarball its runtime cannot load.
# shellcheck disable=SC2016 # the node program is intentionally unexpanded
VERSION="$VERSION" ARCH="$ARCH" node -e '
  const fs = require("node:fs");
  const [source, target] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(source, "utf8"));
  manifest.version = process.env.VERSION;
  manifest.hive = {
    platform: "linux",
    arch: process.env.ARCH,
    nodeVersion: process.versions.node,
    nodeAbi: process.versions.modules,
  };
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
' "$ROOT/backend/package.json" "$pkg/package.json"

# npm represents workspaces as symlinks. The backend package itself is the
# archive root; shared must be replaced with its compiled package contents.
rm -f "$pkg/node_modules/@hive/backend" "$pkg/node_modules/@hive/shared"
mkdir -p "$pkg/node_modules/@hive/shared"
cp -R "$ROOT/shared/dist" "$pkg/node_modules/@hive/shared/dist"
cp "$ROOT/shared/package.json" "$pkg/node_modules/@hive/shared/package.json"

[ ! -L "$pkg/node_modules/@hive/shared" ] || {
  echo "compiled @hive/shared must not be a workspace symlink" >&2
  exit 1
}
[ -f "$pkg/node_modules/@hive/shared/dist/agent-activity.js" ] || {
  echo "compiled @hive/shared is incomplete" >&2
  exit 1
}

# Both addons must load out of the staged tree before anything is published.
RELEASE_DIR="$pkg" node -e 'require(process.env.RELEASE_DIR + "/node_modules/node-pty")'
RELEASE_DIR="$pkg" node -e 'require(process.env.RELEASE_DIR + "/node_modules/sharp")'

tar --no-xattrs -czf "$OUT_DIR/$NAME.tar.gz" -C "$pkg" .

# Prove the archive, not the staging directory: unpack it and load it again.
unpacked="$staging/unpacked"
mkdir -p "$unpacked"
tar -xzf "$OUT_DIR/$NAME.tar.gz" -C "$unpacked"
[ -f "$unpacked/dist/index.js" ] || { echo "archive has no dist/index.js" >&2; exit 1; }
[ -f "$unpacked/LICENSE" ] || { echo "archive has no LICENSE" >&2; exit 1; }
[ "$(cat "$unpacked/VERSION" 2>/dev/null)" = "$VERSION" ] || {
  echo "archive VERSION mismatch: expected $VERSION" >&2
  exit 1
}
artifact_version="$(node -p 'require(process.argv[1]).version' "$unpacked/package.json")"
[ "$artifact_version" = "$VERSION" ] || {
  echo "archive version mismatch: expected $VERSION, got $artifact_version" >&2
  exit 1
}
RELEASE_DIR="$unpacked" node -e 'require(process.env.RELEASE_DIR + "/node_modules/node-pty")'
RELEASE_DIR="$unpacked" node -e 'require(process.env.RELEASE_DIR + "/node_modules/sharp")'

( cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" >"$NAME.tar.gz.sha256" )

echo "-> $OUT_DIR/$NAME.tar.gz"
cat "$OUT_DIR/$NAME.tar.gz.sha256"
