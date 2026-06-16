import type { FastifyInstance } from "fastify";
import { getAllProviderInfo } from "../agents/providers/registry.js";

export interface AgentStatusEntry {
  id: string;
  label: string;
  installed: boolean;
  version: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
}

export interface AgentStatusResponse {
  agents: AgentStatusEntry[];
}

const NPM_REGISTRY_TIMEOUT_MS = 5_000;

/**
 * Fetch the latest published version of an npm package.
 * Returns null on any error (network timeout, 404, parse failure).
 */
async function fetchLatestNpmVersion(packageName: string): Promise<string | null> {
  if (!packageName) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NPM_REGISTRY_TIMEOUT_MS);
    const res = await fetch(
      `https://registry.npmjs.org/${packageName}/latest`,
      { signal: controller.signal },
    );
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Compare two semver-ish strings. Returns true if latest > installed.
 * Only compares numeric segments; returns false on any ambiguity.
 */
function isNewerVersion(installed: string, latest: string): boolean {
  const iParts = installed.split(".").map(Number);
  const lParts = latest.split(".").map(Number);
  const len = Math.max(iParts.length, lParts.length);
  for (let i = 0; i < len; i++) {
    const a = iParts[i] ?? 0;
    const b = lParts[i] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (b > a) return true;
    if (a > b) return false;
  }
  return false;
}

export async function agentSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/cli", async (): Promise<AgentStatusResponse> => {
    const providers = getAllProviderInfo();

    const latestVersions = await Promise.all(
      providers.map((p) => fetchLatestNpmVersion(p.npmPackage)),
    );

    const agents: AgentStatusEntry[] = providers.map((p, i) => {
      const latestVersion = latestVersions[i];
      const updateAvailable =
        p.installed && p.version != null && latestVersion != null
          ? isNewerVersion(p.version, latestVersion)
          : false;

      return {
        id: p.id,
        label: p.label,
        installed: p.installed,
        version: p.version,
        latestVersion,
        updateAvailable,
      };
    });

    return { agents };
  });
}
