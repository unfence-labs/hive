import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface HiveConfig {
  scripts?: { setup?: string; run?: string };
  port?: number;
}

/**
 * Reads and validates hive.json from a workspace root.
 * Returns null if the file is missing, unreadable, or malformed.
 */
export async function readHiveConfig(wsPath: string): Promise<HiveConfig | null> {
  try {
    const raw = await readFile(join(wsPath, "hive.json"), "utf-8");
    const parsed = JSON.parse(raw);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const config: HiveConfig = {};

    if (parsed.scripts && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts)) {
      const scripts: { setup?: string; run?: string } = {};
      if (typeof parsed.scripts.setup === "string") scripts.setup = parsed.scripts.setup;
      if (typeof parsed.scripts.run === "string") scripts.run = parsed.scripts.run;
      if (Object.keys(scripts).length > 0) config.scripts = scripts;
    }

    if (typeof parsed.port === "number" && Number.isInteger(parsed.port) && parsed.port > 0 && parsed.port <= 65535) {
      config.port = parsed.port;
    }

    return config;
  } catch {
    return null;
  }
}
