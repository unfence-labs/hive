import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./state.js";

export interface SidebarFolder {
  id: string;
  name: string;
  projectIds: string[];
}

export interface SidebarPreferences {
  folders: SidebarFolder[];
  folderOpenState: Record<string, boolean>;
}

export interface UiPreferences {
  sidebar: SidebarPreferences;
}

const DEFAULT_SIDEBAR: SidebarPreferences = {
  folders: [],
  folderOpenState: {},
};

const DEFAULT_PREFERENCES: UiPreferences = {
  sidebar: { ...DEFAULT_SIDEBAR },
};

function filePath(dataDir: string): string {
  return join(dataDir, "ui-preferences.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSidebar(raw: unknown): SidebarPreferences {
  if (!isRecord(raw)) return { ...DEFAULT_SIDEBAR, folders: [], folderOpenState: {} };

  const foldersRaw = Array.isArray(raw.folders) ? raw.folders : [];
  const folders: SidebarFolder[] = [];
  const seenFolderIds = new Set<string>();

  for (const entry of foldersRaw) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== "string" || typeof entry.name !== "string") continue;
    if (seenFolderIds.has(entry.id)) continue;

    const name = entry.name.trim();
    if (!entry.id || !name) continue;

    const projectIdsRaw = Array.isArray(entry.projectIds) ? entry.projectIds : [];
    const projectIds = projectIdsRaw.filter((id): id is string => typeof id === "string");

    seenFolderIds.add(entry.id);
    folders.push({ id: entry.id, name, projectIds });
  }

  const openStateRaw = isRecord(raw.folderOpenState) ? raw.folderOpenState : {};
  const folderOpenState: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(openStateRaw)) {
    if (typeof value === "boolean" && seenFolderIds.has(key)) {
      folderOpenState[key] = value;
    }
  }

  return { folders, folderOpenState };
}

export async function loadUiPreferences(dataDir = getDataDir()): Promise<UiPreferences> {
  try {
    const raw = await readFile(filePath(dataDir), "utf-8");
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return structuredClone(DEFAULT_PREFERENCES);
    return { sidebar: parseSidebar(parsed.sidebar) };
  } catch {
    return structuredClone(DEFAULT_PREFERENCES);
  }
}

export async function saveUiPreferences(
  prefs: UiPreferences,
  dataDir = getDataDir(),
): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const target = filePath(dataDir);
  const tmp = join(dataDir, `ui-preferences.${randomUUID()}.tmp`);
  await writeFile(tmp, JSON.stringify(prefs, null, 2), "utf-8");
  await rename(tmp, target);
}

/**
 * Drop folder entries whose projects no longer exist and orphaned open-state keys.
 * Also dedupes project IDs across folders — a project can live in at most one folder.
 */
export function sanitizeUiPreferences(
  prefs: UiPreferences,
  knownProjectIds: string[],
): UiPreferences {
  const known = new Set(knownProjectIds);
  const used = new Set<string>();
  const seenFolderIds = new Set<string>();

  const folders: SidebarFolder[] = [];
  for (const folder of prefs.sidebar.folders) {
    const name = folder.name.trim();
    if (!folder.id || !name || seenFolderIds.has(folder.id)) continue;
    seenFolderIds.add(folder.id);

    const seenInFolder = new Set<string>();
    const projectIds: string[] = [];
    for (const id of folder.projectIds) {
      if (!known.has(id) || used.has(id) || seenInFolder.has(id)) continue;
      used.add(id);
      seenInFolder.add(id);
      projectIds.push(id);
    }

    folders.push({ id: folder.id, name, projectIds });
  }

  const folderOpenState: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(prefs.sidebar.folderOpenState)) {
    if (typeof value === "boolean" && seenFolderIds.has(key)) {
      folderOpenState[key] = value;
    }
  }

  return { sidebar: { folders, folderOpenState } };
}
