import type { FastifyInstance } from "fastify";
import { parseUiPreferencesPayload } from "@hive/shared/sidebar-preferences";
import {
  loadUiPreferences,
  saveUiPreferences,
  sanitizeUiPreferences,
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

  // Reads never sanitize: the persisted file is the source of truth. Running
  // sanitize here would let a transient `listProjects()` failure (empty readdir,
  // unreadable state.json) feed emptied folder.projectIds to the client, which
  // then flushes them back on the next user interaction — permanently wiping
  // the sort order. Display-time filtering (mapSidebarFolderProjects) handles
  // stale refs safely, and project deletion prunes refs explicitly.
  app.get("/api/ui-preferences", async () => {
    return loadUiPreferences(dataDir);
  });

  app.put<{ Body: unknown }>("/api/ui-preferences", async (req, reply) => {
    const parsed = parseUiPreferencesPayload(req.body, { mode: "strict" });
    if (!parsed) {
      return reply.status(400).send({ error: "Invalid ui-preferences payload" });
    }

    const projects = await listProjects(dataDir);
    const payloadHasRefs = parsed.sidebar.folders.some((f) => f.projectIds.length > 0);

    // Safety: listProjects returning [] while the payload references real
    // project IDs almost always means a transient read failure, not that every
    // project was just deleted. Persist the payload verbatim rather than
    // sanitizing every ref out of existence.
    if (projects.length === 0 && payloadHasRefs) {
      await saveUiPreferences(parsed, dataDir);
      return parsed;
    }

    const sanitized = sanitizeUiPreferences(parsed, projects.map((p) => p.id));
    await saveUiPreferences(sanitized, dataDir);
    return sanitized;
  });
}
