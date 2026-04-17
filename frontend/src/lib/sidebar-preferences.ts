import type { Project } from "@/types";
import {
  EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE,
  parseSidebarProjectFoldersState,
  sanitizeSidebarPreferencesState,
  type SidebarProjectFolder,
  type SidebarProjectFoldersState,
  type UiPreferencesPayload,
} from "@hive/shared/sidebar-preferences";

export {
  EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE,
  sanitizeSidebarPreferencesState,
  type SidebarProjectFolder,
  type SidebarProjectFoldersState,
  type UiPreferencesPayload,
};

export type FolderInsertPosition = "before" | "after";
export type ProjectInsertPosition = "before" | "after";

type LocalSeedSource = "cache" | "legacy" | "empty";

const LEGACY_STORAGE_KEY = "hive:sidebar-project-folders:v1";
const CACHE_STORAGE_KEY = "hive:sidebar-project-folders:cache:v1";

function parseStoredState(raw: string | null): SidebarProjectFoldersState | null {
  if (!raw) return null;
  try {
    return parseSidebarProjectFoldersState(JSON.parse(raw), { mode: "permissive" });
  } catch {
    return null;
  }
}

export function readSidebarPreferencesLocalSeed(): {
  source: LocalSeedSource;
  state: SidebarProjectFoldersState;
} {
  if (typeof localStorage === "undefined") {
    return { source: "empty", state: EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE };
  }

  const cached = parseStoredState(localStorage.getItem(CACHE_STORAGE_KEY));
  if (cached) return { source: "cache", state: cached };

  const legacy = parseStoredState(localStorage.getItem(LEGACY_STORAGE_KEY));
  if (legacy) return { source: "legacy", state: legacy };

  return { source: "empty", state: EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE };
}

export function readLegacySidebarPreferences(): SidebarProjectFoldersState | null {
  if (typeof localStorage === "undefined") return null;
  return parseStoredState(localStorage.getItem(LEGACY_STORAGE_KEY));
}

export function writeSidebarPreferencesLocalCache(state: SidebarProjectFoldersState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be full or disabled; ignore.
  }
}

export function removeLegacySidebarPreferences(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function isEmptySidebarPreferencesState(state: SidebarProjectFoldersState): boolean {
  return state.folders.length === 0 && Object.keys(state.folderOpenState).length === 0;
}

export function payloadToSidebarPreferencesState(
  payload: UiPreferencesPayload,
): SidebarProjectFoldersState {
  return payload.sidebar;
}

export function areSidebarPreferencesStatesEqual(
  left: SidebarProjectFoldersState,
  right: SidebarProjectFoldersState,
): boolean {
  if (left.folders.length !== right.folders.length) return false;

  for (let i = 0; i < left.folders.length; i += 1) {
    const leftFolder = left.folders[i];
    const rightFolder = right.folders[i];

    if (leftFolder.id !== rightFolder.id || leftFolder.name !== rightFolder.name) return false;
    if (leftFolder.projectIds.length !== rightFolder.projectIds.length) return false;
    for (let j = 0; j < leftFolder.projectIds.length; j += 1) {
      if (leftFolder.projectIds[j] !== rightFolder.projectIds[j]) return false;
    }
  }

  const leftEntries = Object.entries(left.folderOpenState);
  const rightEntries = Object.entries(right.folderOpenState);
  if (leftEntries.length !== rightEntries.length) return false;

  for (const [folderId, expanded] of leftEntries) {
    if (right.folderOpenState[folderId] !== expanded) return false;
  }

  return true;
}

export function moveProjectBetweenSidebarFolders(
  state: SidebarProjectFoldersState,
  projectId: string,
  targetFolderId: string | null,
): SidebarProjectFoldersState {
  const currentFolderId = state.folders.find((folder) => folder.projectIds.includes(projectId))?.id ?? null;

  if (currentFolderId === targetFolderId) return state;
  if (targetFolderId && !state.folders.some((folder) => folder.id === targetFolderId)) return state;

  const folders = state.folders.map((folder) => ({
    ...folder,
    projectIds: folder.projectIds.filter((id) => id !== projectId),
  }));

  if (!targetFolderId) {
    return { ...state, folders };
  }

  return {
    folders: folders.map((folder) =>
      folder.id !== targetFolderId
        ? folder
        : { ...folder, projectIds: [...folder.projectIds, projectId] },
    ),
    folderOpenState: {
      ...state.folderOpenState,
      [targetFolderId]: true,
    },
  };
}

export function moveProjectWithinSidebarFolders(
  state: SidebarProjectFoldersState,
  projectId: string,
  targetFolderId: string,
  anchorProjectId: string,
  position: ProjectInsertPosition,
): SidebarProjectFoldersState {
  if (projectId === anchorProjectId) return state;

  const targetFolder = state.folders.find((folder) => folder.id === targetFolderId);
  if (!targetFolder) return state;
  if (!targetFolder.projectIds.includes(anchorProjectId)) return state;

  const folders = state.folders.map((folder) => ({
    ...folder,
    projectIds: folder.projectIds.filter((id) => id !== projectId),
  }));

  const nextFolders = folders.map((folder) => {
    if (folder.id !== targetFolderId) return folder;
    const anchorIndex = folder.projectIds.findIndex((id) => id === anchorProjectId);
    if (anchorIndex === -1) return folder;
    const insertIndex = position === "before" ? anchorIndex : anchorIndex + 1;
    const projectIds = [...folder.projectIds];
    projectIds.splice(insertIndex, 0, projectId);
    return { ...folder, projectIds };
  });

  return {
    folders: nextFolders,
    folderOpenState: {
      ...state.folderOpenState,
      [targetFolderId]: true,
    },
  };
}

export function moveSidebarFolder(
  state: SidebarProjectFoldersState,
  folderId: string,
  targetFolderId: string,
  position: FolderInsertPosition,
): SidebarProjectFoldersState {
  if (folderId === targetFolderId) return state;

  const sourceIndex = state.folders.findIndex((folder) => folder.id === folderId);
  const targetIndex = state.folders.findIndex((folder) => folder.id === targetFolderId);
  if (sourceIndex === -1 || targetIndex === -1) return state;

  const folders = [...state.folders];
  const [movedFolder] = folders.splice(sourceIndex, 1);
  const currentTargetIndex = folders.findIndex((folder) => folder.id === targetFolderId);
  if (currentTargetIndex === -1) return state;

  const insertionIndex = position === "before" ? currentTargetIndex : currentTargetIndex + 1;
  folders.splice(insertionIndex, 0, movedFolder);

  return { ...state, folders };
}

export function mapSidebarFolderProjects(
  folders: SidebarProjectFoldersState["folders"],
  projects: Project[],
): Array<SidebarProjectFolder & { projects: Project[] }> {
  const projectMap = new Map(projects.map((project) => [project.id, project]));

  return folders.map((folder) => ({
    ...folder,
    projects: folder.projectIds
      .map((projectId) => projectMap.get(projectId))
      .filter((project): project is Project => project !== undefined),
  }));
}

export function createSidebarFolderProjectMap(
  folders: SidebarProjectFoldersState["folders"],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const folder of folders) {
    for (const projectId of folder.projectIds) {
      map.set(projectId, folder.id);
    }
  }
  return map;
}
