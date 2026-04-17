export interface SidebarProjectFolder {
  id: string;
  name: string;
  projectIds: string[];
}

export interface SidebarProjectFoldersState {
  folders: SidebarProjectFolder[];
  folderOpenState: Record<string, boolean>;
}

export interface UiPreferencesPayload {
  sidebar: SidebarProjectFoldersState;
}

export const EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE: SidebarProjectFoldersState = {
  folders: [],
  folderOpenState: {},
};

export const EMPTY_UI_PREFERENCES_PAYLOAD: UiPreferencesPayload = {
  sidebar: EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE,
};

type ParseMode = "strict" | "permissive";

interface ParseSidebarStateOptions {
  mode?: ParseMode;
  requireFoldersArray?: boolean;
}

interface ParseUiPreferencesOptions {
  mode?: ParseMode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProjectIds(raw: unknown, mode: ParseMode): string[] | null {
  if (!Array.isArray(raw)) {
    return mode === "strict" ? null : [];
  }

  const projectIds = raw.filter((id): id is string => typeof id === "string");
  if (mode === "strict" && projectIds.length !== raw.length) return null;
  return projectIds;
}

function parseFolder(raw: unknown, mode: ParseMode): SidebarProjectFolder | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.name !== "string") return null;

  const projectIds = parseProjectIds(raw.projectIds, mode);
  if (projectIds === null) return null;

  return {
    id: raw.id,
    name: raw.name,
    projectIds,
  };
}

export function parseSidebarProjectFoldersState(
  raw: unknown,
  options: ParseSidebarStateOptions = {},
): SidebarProjectFoldersState | null {
  const mode = options.mode ?? "permissive";
  if (!isRecord(raw)) {
    return mode === "strict" ? null : EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE;
  }

  const foldersValue = raw.folders;
  if (!Array.isArray(foldersValue) && (mode === "strict" || options.requireFoldersArray)) {
    return null;
  }

  const foldersRaw = Array.isArray(foldersValue) ? foldersValue : [];
  const folders: SidebarProjectFolder[] = [];
  for (const entry of foldersRaw) {
    const folder = parseFolder(entry, mode);
    if (!folder) {
      if (mode === "strict") return null;
      continue;
    }
    folders.push(folder);
  }

  const openStateValue = raw.folderOpenState;
  if (openStateValue !== undefined && !isRecord(openStateValue)) {
    return mode === "strict" ? null : { folders, folderOpenState: {} };
  }

  const openStateRaw = isRecord(openStateValue) ? openStateValue : {};
  const folderOpenState: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(openStateRaw)) {
    if (typeof value !== "boolean") {
      if (mode === "strict") return null;
      continue;
    }
    folderOpenState[key] = value;
  }

  const parsedState = { folders, folderOpenState };
  return mode === "permissive"
    ? normalizeSidebarPreferencesState(parsedState)
    : parsedState;
}

export function parseUiPreferencesPayload(
  raw: unknown,
  options: ParseUiPreferencesOptions = {},
): UiPreferencesPayload | null {
  const mode = options.mode ?? "strict";
  if (!isRecord(raw) || !isRecord(raw.sidebar)) return null;

  const sidebar = parseSidebarProjectFoldersState(raw.sidebar, {
    mode,
    requireFoldersArray: true,
  });
  if (!sidebar) return null;

  return { sidebar };
}

export function sanitizeSidebarPreferencesState(
  state: SidebarProjectFoldersState,
  projectIds: string[],
): SidebarProjectFoldersState {
  const knownProjectIds = new Set(projectIds);
  const usedProjectIds = new Set<string>();
  const seenFolderIds = new Set<string>();

  const folders = state.folders.flatMap((folder): SidebarProjectFolder[] => {
    const name = folder.name.trim();
    if (!folder.id || !name || seenFolderIds.has(folder.id)) return [];
    seenFolderIds.add(folder.id);

    const seenProjectIds = new Set<string>();
    const nextProjectIds = folder.projectIds.filter((projectId) => {
      if (!knownProjectIds.has(projectId)) return false;
      if (usedProjectIds.has(projectId)) return false;
      if (seenProjectIds.has(projectId)) return false;
      usedProjectIds.add(projectId);
      seenProjectIds.add(projectId);
      return true;
    });

    return [{
      id: folder.id,
      name,
      projectIds: nextProjectIds,
    }];
  });

  const folderOpenState = Object.fromEntries(
    Object.entries(state.folderOpenState).filter(([folderId, value]) =>
      seenFolderIds.has(folderId) && typeof value === "boolean",
    ),
  );

  return { folders, folderOpenState };
}

export function normalizeSidebarPreferencesState(
  state: SidebarProjectFoldersState,
): SidebarProjectFoldersState {
  const seenFolderIds = new Set<string>();
  const folders = state.folders.flatMap((folder): SidebarProjectFolder[] => {
    const name = folder.name.trim();
    if (!folder.id || !name || seenFolderIds.has(folder.id)) return [];
    seenFolderIds.add(folder.id);
    return [{
      id: folder.id,
      name,
      projectIds: folder.projectIds,
    }];
  });

  const folderOpenState = Object.fromEntries(
    Object.entries(state.folderOpenState).filter(([folderId, value]) =>
      seenFolderIds.has(folderId) && typeof value === "boolean",
    ),
  );

  return { folders, folderOpenState };
}

export function sanitizeUiPreferencesPayload(
  payload: UiPreferencesPayload,
  projectIds: string[],
): UiPreferencesPayload {
  return {
    sidebar: sanitizeSidebarPreferencesState(payload.sidebar, projectIds),
  };
}
