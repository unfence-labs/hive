import { useCallback, useEffect, useMemo, useState } from "react";
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

export interface SidebarProjectFolderView extends SidebarProjectFolder {
  projects: Project[];
}

const STORAGE_KEY = "hive:sidebar-project-folders:v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readStoredState(): SidebarProjectFoldersState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { folders: [], folderOpenState: {} };
    }

    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { folders: [], folderOpenState: {} };
    }

    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    const folderOpenState = isRecord(parsed.folderOpenState) ? parsed.folderOpenState : {};

    return {
      folders: folders.flatMap((folder): SidebarProjectFolder[] => {
        if (!isRecord(folder)) return [];
        if (typeof folder.id !== "string" || typeof folder.name !== "string") return [];

        const projectIds = Array.isArray(folder.projectIds)
          ? folder.projectIds.filter((projectId): projectId is string => typeof projectId === "string")
          : [];

        return [{
          id: folder.id,
          name: folder.name,
          projectIds,
        }];
      }),
      folderOpenState: Object.fromEntries(
        Object.entries(folderOpenState).flatMap(([key, value]) =>
          typeof value === "boolean" ? [[key, value] as const] : [],
        ),
      ),
    };
  } catch {
    return { folders: [], folderOpenState: {} };
  }
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
    sanitizeState(readStoredState(), projectIds),
  );

  const projectIdsKey = useMemo(
    () => [...projectIds].sort().join(","),
    [projectIds],
  );

  useEffect(() => {
    setState((prev) => {
      const next = sanitizeState(prev, projectIds);
      return areStatesEqual(prev, next) ? prev : next;
    });
  }, [projectIds, projectIdsKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  const moveProjectToFolder = useCallback((projectId: string, targetFolderId: string | null) => {
    setState((prev) => moveProject(prev, projectId, targetFolderId));
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
    moveProjectToFolder,
    isFolderExpanded,
    setFolderExpanded,
    getFolderIdForProject,
  };
}
