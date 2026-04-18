import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  EMPTY_UI_PREFERENCES_PAYLOAD,
  parseUiPreferencesPayload,
  sanitizeUiPreferencesPayload,
  type SidebarProjectFolder,
  type SidebarProjectFoldersState,
  type UiPreferencesPayload,
} from "@hive/shared/sidebar-preferences";
import { getDataDir } from "./state.js";

export type SidebarFolder = SidebarProjectFolder;
export type SidebarPreferences = SidebarProjectFoldersState;
export type UiPreferences = UiPreferencesPayload;

function filePath(dataDir: string): string {
  return join(dataDir, "ui-preferences.json");
}

export async function loadUiPreferences(dataDir = getDataDir()): Promise<UiPreferences> {
  try {
    const raw = await readFile(filePath(dataDir), "utf-8");
    const parsed = parseUiPreferencesPayload(JSON.parse(raw), { mode: "permissive" });
    return parsed ?? structuredClone(EMPTY_UI_PREFERENCES_PAYLOAD);
  } catch {
    return structuredClone(EMPTY_UI_PREFERENCES_PAYLOAD);
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
  return sanitizeUiPreferencesPayload(prefs, knownProjectIds);
}

/**
 * Remove a project's id from every folder and persist. Call this from
 * project deletion — it's the only moment we know for sure the project is gone.
 * No-op when the project isn't referenced anywhere.
 */
export async function pruneProjectFromUiPreferences(
  projectId: string,
  dataDir = getDataDir(),
): Promise<void> {
  const prefs = await loadUiPreferences(dataDir);
  let changed = false;
  const folders = prefs.sidebar.folders.map((folder) => {
    const filtered = folder.projectIds.filter((id) => id !== projectId);
    if (filtered.length !== folder.projectIds.length) changed = true;
    return { ...folder, projectIds: filtered };
  });
  if (!changed) return;
  await saveUiPreferences(
    { sidebar: { folders, folderOpenState: prefs.sidebar.folderOpenState } },
    dataDir,
  );
}
