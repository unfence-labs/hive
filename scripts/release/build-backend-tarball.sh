#!/usr/bin/env bash
# Build a lockfile-pinned backend release for one Linux architecture.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-0.0.0-dev}"
ARCH="${2:-}"

if [[ ! "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$ ]]; then
  echo "invalid semantic version: $VERSION" >&2
  exit 2
fi

if [ -z "$ARCH" ]; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64|arm64) ARCH=arm64 ;;
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 2 ;;
  esac
fi
case "$ARCH" in
  x64|arm64) : ;;
  *) echo "unsupported release architecture: $ARCH" >&2; exit 2 ;;
esac

OUT_DIR="${OUT_DIR:-$ROOT/dist-release}"
NAME="hive-backend-$VERSION-linux-$ARCH"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

echo "Building $NAME..."
mkdir -p "$OUT_DIR"

# Build from the repository lockfile. Clean output first so stale test files
# from older tsconfig settings cannot leak into the archive.
( cd "$ROOT" && npm ci --workspaces --include-workspace-root >/dev/null )
rm -rf "$ROOT/backend/dist" "$ROOT/shared/dist"
( cd "$ROOT/backend" && npm run build >/dev/null )

if find "$ROOT/backend/dist" -type f \( -name '*.test.*' -o -name 'fake-pty.*' -o -name 'test-helpers.*' \) -print -quit | grep -q .; then
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
node -e '
  const fs = require("node:fs");
  const [source, target, version] = process.argv.slice(1);
  const manifest = JSON.parse(fs.readFileSync(source, "utf8"));
  manifest.version = version;
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
' "$ROOT/backend/package.json" "$pkg/package.json" "$VERSION"
cp -R "$install_root/node_modules" "$pkg/node_modules"

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
[ -f "$pkg/node_modules/@hive/shared/dist/setup-types.js" ] || {
  echo "compiled @hive/shared is incomplete" >&2
  exit 1
}

# Release runners are native Linux hosts matching ARCH, so both addons must
# load before publishing. Cross-platform local dev builds are verified and,
# if needed, rebuilt on the target by the explicit dev provisioning path.
host_arch=""
case "$(uname -m)" in
  x86_64) host_arch=x64 ;;
  aarch64|arm64) host_arch=arm64 ;;
esac
if [ "$(uname -s)" = Linux ] && [ "$host_arch" = "$ARCH" ]; then
  RELEASE_DIR="$pkg" node -e 'require(process.env.RELEASE_DIR + "/node_modules/node-pty")'
  RELEASE_DIR="$pkg" node -e 'require(process.env.RELEASE_DIR + "/node_modules/sharp")'
fi

COPYFILE_DISABLE=1 tar --no-xattrs -czf "$OUT_DIR/$NAME.tar.gz" -C "$pkg" .
artifact_version="$(tar -xOf "$OUT_DIR/$NAME.tar.gz" ./package.json | \
  node -e 'let s=""; process.stdin.on("data", c => s += c).on("end", () => process.stdout.write(JSON.parse(s).version))')"
[ "$artifact_version" = "$VERSION" ] || {
  echo "archive version mismatch: expected $VERSION, got $artifact_version" >&2
  exit 1
}
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" >"$NAME.tar.gz.sha256" )
else
  ( cd "$OUT_DIR" && shasum -a 256 "$NAME.tar.gz" >"$NAME.tar.gz.sha256" )
fi

echo "-> $OUT_DIR/$NAME.tar.gz"
cat "$OUT_DIR/$NAME.tar.gz.sha256"
