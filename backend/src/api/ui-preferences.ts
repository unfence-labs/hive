import type { FastifyInstance } from "fastify";
import {
  loadUiPreferences,
  saveUiPreferences,
  sanitizeUiPreferences,
  type UiPreferences,
  type SidebarFolder,
} from "../state/ui-preferences.js";
import { getDataDir } from "../state/state.js";
import { listProjects } from "../projects/project-manager.js";

interface UiPreferencesRoutesOptions {
  dataDir?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): UiPreferences | null {
  if (!isRecord(body)) return null;
  if (!isRecord(body.sidebar)) return null;

  const foldersRaw = Array.isArray(body.sidebar.folders) ? body.sidebar.folders : null;
  if (!foldersRaw) return null;

  const folders: SidebarFolder[] = [];
  for (const entry of foldersRaw) {
    if (!isRecord(entry)) return null;
    if (typeof entry.id !== "string" || typeof entry.name !== "string") return null;
    if (!Array.isArray(entry.projectIds)) return null;
    const projectIds = entry.projectIds.filter((id): id is string => typeof id === "string");
    if (projectIds.length !== entry.projectIds.length) return null;
    folders.push({ id: entry.id, name: entry.name, projectIds });
  }

  const openStateRaw = isRecord(body.sidebar.folderOpenState) ? body.sidebar.folderOpenState : {};
  const folderOpenState: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(openStateRaw)) {
    if (typeof value !== "boolean") return null;
    folderOpenState[key] = value;
  }

  return { sidebar: { folders, folderOpenState } };
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
    const parsed = parseBody(req.body);
    if (!parsed) {
      return reply.status(400).send({ error: "Invalid ui-preferences payload" });
    }

    const projects = await listProjects(dataDir);
    const sanitized = sanitizeUiPreferences(parsed, projects.map((p) => p.id));
    await saveUiPreferences(sanitized, dataDir);
    return sanitized;
  });
}
