import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { Project } from "@/types";

export interface SidebarProjectFolder {
  id: string;
  name: string;
  projectIds: string[];
}

interface SidebarProjectFoldersState {
  folders: SidebarProjectFolder[];
  folderOpenState: Record<string, boolean>;
}

interface UiPreferencesPayload {
  sidebar: SidebarProjectFoldersState;
}

type FolderInsertPosition = "before" | "after";
type ProjectInsertPosition = "before" | "after";

export interface SidebarProjectFolderView extends SidebarProjectFolder {
  projects: Project[];
}

const LEGACY_STORAGE_KEY = "hive:sidebar-project-folders:v1";
const CACHE_STORAGE_KEY = "hive:sidebar-project-folders:cache:v1";
const FLUSH_DEBOUNCE_MS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseStoredState(raw: string | null): SidebarProjectFoldersState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const foldersRaw = Array.isArray(parsed.folders) ? parsed.folders : [];
    const folders = foldersRaw.flatMap((folder): SidebarProjectFolder[] => {
      if (!isRecord(folder)) return [];
      if (typeof folder.id !== "string" || typeof folder.name !== "string") return [];
      const projectIds = Array.isArray(folder.projectIds)
        ? folder.projectIds.filter((id): id is string => typeof id === "string")
        : [];
      return [{ id: folder.id, name: folder.name, projectIds }];
    });

    const openStateRaw = isRecord(parsed.folderOpenState) ? parsed.folderOpenState : {};
    const folderOpenState = Object.fromEntries(
      Object.entries(openStateRaw).flatMap(([key, value]) =>
        typeof value === "boolean" ? [[key, value] as const] : [],
      ),
    );

    return { folders, folderOpenState };
  } catch {
    return null;
  }
}

function readLocalCache(): SidebarProjectFoldersState {
  if (typeof localStorage === "undefined") return { folders: [], folderOpenState: {} };
  return (
    parseStoredState(localStorage.getItem(CACHE_STORAGE_KEY)) ??
    parseStoredState(localStorage.getItem(LEGACY_STORAGE_KEY)) ??
    { folders: [], folderOpenState: {} }
  );
}

function readLegacyStorage(): SidebarProjectFoldersState | null {
  if (typeof localStorage === "undefined") return null;
  return parseStoredState(localStorage.getItem(LEGACY_STORAGE_KEY));
}

function writeLocalCache(state: SidebarProjectFoldersState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be full or disabled; ignore.
  }
}

function isEmptyState(state: SidebarProjectFoldersState): boolean {
  return state.folders.length === 0 && Object.keys(state.folderOpenState).length === 0;
}

function sanitizeState(
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
    const projectIds = folder.projectIds.filter((projectId) => {
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
      projectIds,
    }];
  });

  const folderOpenState = Object.fromEntries(
    Object.entries(state.folderOpenState).filter(([folderId, value]) =>
      seenFolderIds.has(folderId) && typeof value === "boolean",
    ),
  );

  return { folders, folderOpenState };
}

function moveProject(
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

function moveProjectToPositionImpl(
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

function moveFolder(
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

function createId(): string {
  return self.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function areStatesEqual(
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

export function useSidebarProjectFolders(projects: Project[]) {
  const projectIds = useMemo(
    () => projects.map((project) => project.id),
    [projects],
  );

  const [state, setState] = useState<SidebarProjectFoldersState>(() =>
    sanitizeState(readLocalCache(), projectIds),
  );

  const projectIdsKey = useMemo(
    () => [...projectIds].sort().join(","),
    [projectIds],
  );

  // Remote fetch (single source of truth after first hydration).
  const query = useQuery({
    queryKey: ["ui-preferences"],
    queryFn: () => api.get<UiPreferencesPayload>("/api/ui-preferences"),
    staleTime: 60_000,
  });

  // Track whether the first server response has been applied. Before that,
  // we don't PUT anything (the user hasn't seen the server state yet, and
  // flushing cached/legacy data would clobber it).
  const hydratedRef = useRef(false);
  const lastFlushedRef = useRef<SidebarProjectFoldersState | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from server when data arrives.
  useEffect(() => {
    if (!query.data) return;
    const serverState: SidebarProjectFoldersState = {
      folders: query.data.sidebar.folders,
      folderOpenState: query.data.sidebar.folderOpenState,
    };

    // One-shot migration: empty server + legacy localStorage -> push legacy up.
    if (!hydratedRef.current && isEmptyState(serverState)) {
      const legacy = readLegacyStorage();
      if (legacy && !isEmptyState(legacy)) {
        const sanitized = sanitizeState(legacy, projectIds);
        hydratedRef.current = true;
        lastFlushedRef.current = serverState;
        setState(sanitized);
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // ignore
        }
        return;
      }
    }

    hydratedRef.current = true;
    lastFlushedRef.current = serverState;
    setState((prev) => {
      const next = sanitizeState(serverState, projectIds);
      return areStatesEqual(prev, next) ? prev : next;
    });
  }, [query.data, projectIds, projectIdsKey]);

  // Re-sanitize when the list of projects changes (e.g. project deleted).
  useEffect(() => {
    setState((prev) => {
      const next = sanitizeState(prev, projectIds);
      return areStatesEqual(prev, next) ? prev : next;
    });
  }, [projectIds, projectIdsKey]);

  // Persist local cache immediately + schedule a debounced PUT to the backend.
  useEffect(() => {
    writeLocalCache(state);

    if (!hydratedRef.current) return;
    if (lastFlushedRef.current && areStatesEqual(lastFlushedRef.current, state)) return;

    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      const snapshot = state;
      api
        .put<UiPreferencesPayload>("/api/ui-preferences", { sidebar: snapshot })
        .then((payload) => {
          const applied: SidebarProjectFoldersState = {
            folders: payload.sidebar.folders,
            folderOpenState: payload.sidebar.folderOpenState,
          };
          lastFlushedRef.current = applied;
        })
        .catch(() => {
          // Revert to last-known server state on failure.
          if (lastFlushedRef.current) {
            setState(lastFlushedRef.current);
          }
        });
    }, FLUSH_DEBOUNCE_MS);

    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [state]);

  const projectMap = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const folders = useMemo<SidebarProjectFolderView[]>(
    () =>
      state.folders.map((folder) => ({
        ...folder,
        projects: folder.projectIds
          .map((projectId) => projectMap.get(projectId))
          .filter((project): project is Project => project !== undefined),
      })),
    [projectMap, state.folders],
  );

  const projectFolderMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const folder of state.folders) {
      for (const projectId of folder.projectIds) {
        map.set(projectId, folder.id);
      }
    }
    return map;
  }, [state.folders]);

  const rootProjects = useMemo(
    () => projects.filter((project) => !projectFolderMap.has(project.id)),
    [projectFolderMap, projects],
  );

  const createFolder = useCallback((name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;

    const folderId = createId();
    setState((prev) => ({
      folders: [
        ...prev.folders,
        { id: folderId, name: trimmedName, projectIds: [] },
      ],
      folderOpenState: {
        ...prev.folderOpenState,
        [folderId]: true,
      },
    }));

    return folderId;
  }, []);

  const renameFolder = useCallback((folderId: string, nextName: string) => {
    const trimmed = nextName.trim();
    if (!trimmed) return false;
    setState((prev) => {
      const target = prev.folders.find((folder) => folder.id === folderId);
      if (!target || target.name === trimmed) return prev;
      return {
        ...prev,
        folders: prev.folders.map((folder) =>
          folder.id === folderId ? { ...folder, name: trimmed } : folder,
        ),
      };
    });
    return true;
  }, []);

  const deleteFolder = useCallback((folderId: string) => {
    let deleted = false;
    setState((prev) => {
      const target = prev.folders.find((folder) => folder.id === folderId);
      if (!target || target.projectIds.length > 0) return prev;
      deleted = true;
      const { [folderId]: _removed, ...folderOpenState } = prev.folderOpenState;
      return {
        folders: prev.folders.filter((folder) => folder.id !== folderId),
        folderOpenState,
      };
    });
    return deleted;
  }, []);

  const moveProjectToFolder = useCallback((projectId: string, targetFolderId: string | null) => {
    setState((prev) => moveProject(prev, projectId, targetFolderId));
  }, []);

  const moveProjectToPosition = useCallback((
    projectId: string,
    targetFolderId: string,
    anchorProjectId: string,
    position: ProjectInsertPosition,
  ) => {
    setState((prev) => moveProjectToPositionImpl(prev, projectId, targetFolderId, anchorProjectId, position));
  }, []);

  const moveFolderById = useCallback((
    folderId: string,
    targetFolderId: string,
    position: FolderInsertPosition,
  ) => {
    setState((prev) => moveFolder(prev, folderId, targetFolderId, position));
  }, []);

  const setFolderExpanded = useCallback((folderId: string, expanded: boolean) => {
    setState((prev) => {
      if (!prev.folders.some((folder) => folder.id === folderId)) return prev;
      if ((prev.folderOpenState[folderId] ?? true) === expanded) return prev;
      return {
        ...prev,
        folderOpenState: {
          ...prev.folderOpenState,
          [folderId]: expanded,
        },
      };
    });
  }, []);

  const isFolderExpanded = useCallback(
    (folderId: string) => state.folderOpenState[folderId] ?? true,
    [state.folderOpenState],
  );

  const getFolderIdForProject = useCallback(
    (projectId: string) => projectFolderMap.get(projectId) ?? null,
    [projectFolderMap],
  );

  return {
    folders,
    rootProjects,
    createFolder,
    renameFolder,
    deleteFolder,
    moveProjectToFolder,
    moveProjectToPosition,
    moveFolderById,
    isFolderExpanded,
    setFolderExpanded,
    getFolderIdForProject,
  };
}
