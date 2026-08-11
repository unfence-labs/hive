import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";

export type UpdateMethod = "manual" | "provisioner";

/**
 * PM2 supplies the canonical checkout version. Release tarballs instead carry
 * a VERSION file at their root, next to dist/. Other source processes have
 * neither and report "dev".
 */
export async function readBackendVersion(
  versionFile: URL = new URL("../../VERSION", import.meta.url),
  configuredVersion: string | undefined = process.env.HIVE_BACKEND_VERSION,
): Promise<string> {
  const version = configuredVersion?.trim();
  if (version) return version;

  try {
    return (await readFile(versionFile, "utf8")).trim() || "dev";
  } catch {
    return "dev";
  }
}

/** Only a provisioner-owned installation may use the in-app update flow. */
export function readUpdateMethod(
  configuredMethod: string | undefined = process.env.HIVE_UPDATE_METHOD,
): UpdateMethod {
  return configuredMethod === "provisioner" ? "provisioner" : "manual";
}

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/server/version", async () => ({
    version: await readBackendVersion(),
    updateMethod: readUpdateMethod(),
  }));
}
