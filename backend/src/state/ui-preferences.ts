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
} from "../../../shared/sidebar-preferences.js";
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
