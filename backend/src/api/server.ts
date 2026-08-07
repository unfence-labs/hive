import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";

/**
 * The release tarball carries a VERSION file at its root, written by
 * scripts/release/build-backend-tarball.sh next to dist/. A source checkout
 * has no such file and reports "dev".
 */
export async function readBackendVersion(
  versionFile: URL = new URL("../../VERSION", import.meta.url),
): Promise<string> {
  try {
    return (await readFile(versionFile, "utf8")).trim() || "dev";
  } catch {
    return "dev";
  }
}

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/server/version", async () => ({
    version: await readBackendVersion(),
  }));
}
