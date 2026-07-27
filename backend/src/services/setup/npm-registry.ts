const NPM_REGISTRY_TIMEOUT_MS = 5_000;

/**
 * Latest published version of an npm package. Returns null on any failure —
 * a registry that is unreachable must degrade the panel to "version unknown",
 * never fail the whole status request.
 */
export async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  if (!packageName) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NPM_REGISTRY_TIMEOUT_MS);
    try {
      const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { version?: string };
      return data.version ?? null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Compare two semver-ish strings. True when `latest` is newer. Only numeric
 * segments are compared, and any ambiguity answers false: offering a
 * pointless update is worse than missing one.
 */
export function isNewerVersion(installed: string, latest: string): boolean {
  const installedParts = installed.split(".").map(Number);
  const latestParts = latest.split(".").map(Number);
  const length = Math.max(installedParts.length, latestParts.length);
  for (let i = 0; i < length; i++) {
    const a = installedParts[i] ?? 0;
    const b = latestParts[i] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (b > a) return true;
    if (a > b) return false;
  }
  return false;
}
