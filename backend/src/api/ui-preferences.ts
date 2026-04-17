import type { FastifyInstance } from "fastify";
import { parseUiPreferencesPayload } from "@hive/shared/sidebar-preferences";
import {
  loadUiPreferences,
  saveUiPreferences,
  sanitizeUiPreferences,
  type UiPreferences,
} from "../state/ui-preferences.js";
import { getDataDir } from "../state/state.js";
import { listProjects } from "../projects/project-manager.js";

interface UiPreferencesRoutesOptions {
  dataDir?: string;
}

export async function uiPreferencesRoutes(
  app: FastifyInstance,
  opts: UiPreferencesRoutesOptions = {},
): Promise<void> {
  const dataDir = opts.dataDir ?? getDataDir();

  app.get("/api/ui-preferences", async () => {
    const [prefs, projects] = await Promise.all([
      loadUiPreferences(dataDir),
      listProjects(dataDir),
    ]);
    return sanitizeUiPreferences(prefs, projects.map((p) => p.id));
  });

  app.put<{ Body: unknown }>("/api/ui-preferences", async (req, reply) => {
    const parsed = parseUiPreferencesPayload(req.body, { mode: "strict" });
    if (!parsed) {
      return reply.status(400).send({ error: "Invalid ui-preferences payload" });
    }

    const projects = await listProjects(dataDir);
    const sanitized = sanitizeUiPreferences(parsed, projects.map((p) => p.id));
    await saveUiPreferences(sanitized, dataDir);
    return sanitized;
  });
}
