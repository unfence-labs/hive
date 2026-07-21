import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Import attributes (`with { type: "json" }`) are not supported under the repo's
// Node16 module mode, so read package.json from disk instead. Path is resolved
// from this module's location (src/ at dev, dist/api/ when compiled — both are
// two levels below the package root).
function readBackendVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, "..", "..", "package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const BACKEND_VERSION = readBackendVersion();

/** The backend version, read from package.json. Reported on /health. */
export function getBackendVersion(): string {
  return BACKEND_VERSION;
}
