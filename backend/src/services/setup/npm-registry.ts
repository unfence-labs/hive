import { compareVersions } from "../../utils/version.js";

const NPM_REGISTRY_TIMEOUT_MS = 5_000;

/**
 * How long a looked-up version stays trusted. The registry's `latest` moves on
 * the package's release cadence, not on the panel's poll cadence, so asking
 * again within minutes only re-learns the same answer. Failures are not
 * cached: a registry that was unreachable should be retried, not remembered.
 */
const CACHE_TTL_MS = 5 * 60_000;

const latestVersionCache = new Map<string, { version: string; fetchedAt: number }>();

/**
 * Latest published version of an npm package. Returns null on any failure —
 * a registry that is unreachable must degrade the panel to "version unknown",
 * never fail the whole status request.
 */
export async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  if (!packageName) return null;
  const cached = latestVersionCache.get(packageName);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.version;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NPM_REGISTRY_TIMEOUT_MS);
    try {
      const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
        signal: controller.signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { version?: string };
      const version = data.version ?? null;
      if (version) latestVersionCache.set(packageName, { version, fetchedAt: Date.now() });
      return version;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * True when `latest` is newer than `installed`. Any ambiguity answers false:
 * offering a pointless update is worse than missing one.
 */
export function isNewerVersion(installed: string, latest: string): boolean {
  return compareVersions(latest, installed) > 0;
}
