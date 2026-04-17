import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { Project } from "@/types";
import {
  EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE,
  areSidebarPreferencesStatesEqual,
  createSidebarFolderProjectMap,
  mapSidebarFolderProjects,
  moveProjectBetweenSidebarFolders,
  moveProjectWithinSidebarFolders,
  moveSidebarFolder,
  payloadToSidebarPreferencesState,
  readLegacySidebarPreferences,
  readSidebarPreferencesLocalSeed,
  removeLegacySidebarPreferences,
  sanitizeSidebarPreferencesState,
  writeSidebarPreferencesLocalCache,
  isEmptySidebarPreferencesState,
  type FolderInsertPosition,
  type ProjectInsertPosition,
  type SidebarProjectFolder,
  type SidebarProjectFoldersState,
  type UiPreferencesPayload,
} from "@/lib/sidebar-preferences";

export interface SidebarProjectFolderView extends SidebarProjectFolder {
  projects: Project[];
}

const FLUSH_DEBOUNCE_MS = 300;

function createId(): string {
  return self.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

export function useSidebarProjectFolders(projects: Project[], projectsReady = true) {
  const queryClient = useQueryClient();
  const projectIds = useMemo(
    () => projects.map((project) => project.id),
    [projects],
  );

  const initialLocalSeedRef = useRef(readSidebarPreferencesLocalSeed());
  const bootstrappedRef = useRef(false);
  const [hasInitialHydration, setHasInitialHydration] = useState(false);
  const [state, setState] = useState<SidebarProjectFoldersState>(
    EMPTY_SIDEBAR_PROJECT_FOLDERS_STATE,
  );

  const projectIdsKey = useMemo(
    () => [...projectIds].sort().join(","),
    [projectIds],
  );

  // Remote fetch (single source of truth after first hydration).
  const {
    data: preferencesData,
    error: preferencesError,
    isFetched: preferencesFetched,
    refetch: refetchPreferences,
  } = useQuery({
    queryKey: ["ui-preferences"],
    queryFn: () => api.get<UiPreferencesPayload>("/api/ui-preferences"),
    retry: false,
    staleTime: 60_000,
  });

  // Track whether the first server response has been applied. Before that,
  // we don't PUT anything (the user hasn't seen the server state yet, and
  // flushing cached/legacy data would clobber it).
  const hydratedRef = useRef(false);
  const lastFlushedRef = useRef<SidebarProjectFoldersState | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestStartedSaveRef = useRef(0);
  const latestSuccessfulSaveRef = useRef(0);
  const pendingLegacyRemovalRef = useRef(false);

  useEffect(() => {
    if (!projectsReady) return;
    if (bootstrappedRef.current || hydratedRef.current) return;

    bootstrappedRef.current = true;
    const next = sanitizeSidebarPreferencesState(initialLocalSeedRef.current.state, projectIds);
    setState((prev) => (areSidebarPreferencesStatesEqual(prev, next) ? prev : next));
  }, [projectIds, projectIdsKey, projectsReady]);

  // Hydrate from server when data arrives.
  useEffect(() => {
    if (!projectsReady || !preferencesData) return;
    const serverState = sanitizeSidebarPreferencesState(
      payloadToSidebarPreferencesState(preferencesData),
      projectIds,
    );

    // One-shot migration: empty server + legacy localStorage -> push legacy up.
    if (!hydratedRef.current && isEmptySidebarPreferencesState(serverState)) {
      const legacy = readLegacySidebarPreferences();
      if (legacy && !isEmptySidebarPreferencesState(legacy)) {
        const sanitized = sanitizeSidebarPreferencesState(legacy, projectIds);
        if (!isEmptySidebarPreferencesState(sanitized)) {
          hydratedRef.current = true;
          setHasInitialHydration(true);
          lastFlushedRef.current = serverState;
          bootstrappedRef.current = true;
          pendingLegacyRemovalRef.current = true;
          setState(sanitized);
          return;
        }
      }
    }

    hydratedRef.current = true;
    setHasInitialHydration(true);
    lastFlushedRef.current = serverState;
    bootstrappedRef.current = true;
    setState((prev) => {
      return areSidebarPreferencesStatesEqual(prev, serverState) ? prev : serverState;
    });
  }, [preferencesData, projectIds, projectIdsKey, projectsReady]);

  useEffect(() => {
    if (!projectsReady) return;
    if (hydratedRef.current) return;
    if (!preferencesFetched || !preferencesError) return;

    hydratedRef.current = true;
    setHasInitialHydration(true);
    bootstrappedRef.current = true;
  }, [preferencesError, preferencesFetched, projectsReady]);

  // Re-sanitize when the list of projects changes (e.g. project deleted).
  useEffect(() => {
    if (!projectsReady || !bootstrappedRef.current) return;
    setState((prev) => {
      const next = sanitizeSidebarPreferencesState(prev, projectIds);
      return areSidebarPreferencesStatesEqual(prev, next) ? prev : next;
    });
  }, [projectIds, projectIdsKey, projectsReady]);

  // Persist local cache immediately + schedule a debounced PUT to the backend.
  useEffect(() => {
    const canWriteLocalCache =
      bootstrappedRef.current
      && (hydratedRef.current || initialLocalSeedRef.current.source !== "legacy");

    if (canWriteLocalCache) {
      writeSidebarPreferencesLocalCache(state);
    }

    if (!hydratedRef.current) return;
    if (
      lastFlushedRef.current
      && areSidebarPreferencesStatesEqual(lastFlushedRef.current, state)
    ) {
      return;
    }

    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      const snapshot = state;
      const requestId = latestStartedSaveRef.current + 1;
      latestStartedSaveRef.current = requestId;

      api
        .put<UiPreferencesPayload>("/api/ui-preferences", { sidebar: snapshot })
        .then((payload) => {
          const applied = sanitizeSidebarPreferencesState(
            payloadToSidebarPreferencesState(payload),
            projectIds,
          );
          queryClient.setQueryData<UiPreferencesPayload>(
            ["ui-preferences"],
            { sidebar: applied },
          );

          if (requestId > latestSuccessfulSaveRef.current) {
            latestSuccessfulSaveRef.current = requestId;
            lastFlushedRef.current = applied;
          }

          if (pendingLegacyRemovalRef.current) {
            removeLegacySidebarPreferences();
            pendingLegacyRemovalRef.current = false;
          }
        })
        .catch(async () => {
          if (requestId !== latestStartedSaveRef.current) return;

          try {
            const result = await refetchPreferences();
            if (result.data) {
              const canonical = sanitizeSidebarPreferencesState(
                payloadToSidebarPreferencesState(result.data),
                projectIds,
              );
              lastFlushedRef.current = canonical;
              setState((prev) => (
                areSidebarPreferencesStatesEqual(prev, canonical) ? prev : canonical
              ));
              return;
            }
          } catch {
            // Fall back to the last known server state below.
          }

          if (lastFlushedRef.current) {
            const fallback = lastFlushedRef.current;
            setState((prev) => (
              areSidebarPreferencesStatesEqual(prev, fallback) ? prev : fallback
            ));
          }
        });
    }, FLUSH_DEBOUNCE_MS);

    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [projectIds, projectIdsKey, queryClient, refetchPreferences, state]);

  const folders = useMemo<SidebarProjectFolderView[]>(
    () => mapSidebarFolderProjects(state.folders, projects),
    [projects, state.folders],
  );

  const projectFolderMap = useMemo(
    () => createSidebarFolderProjectMap(state.folders),
    [state.folders],
  );

  const rootProjects = useMemo(
    () => projects.filter((project) => !projectFolderMap.has(project.id)),
    [projectFolderMap, projects],
  );

  const createFolder = useCallback((name: string) => {
    if (!hydratedRef.current) return null;
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
    if (!hydratedRef.current) return false;
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
    if (!hydratedRef.current) return false;
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
    if (!hydratedRef.current) return;
    setState((prev) => moveProjectBetweenSidebarFolders(prev, projectId, targetFolderId));
  }, []);

  const moveProjectToPosition = useCallback((
    projectId: string,
    targetFolderId: string,
    anchorProjectId: string,
    position: ProjectInsertPosition,
  ) => {
    if (!hydratedRef.current) return;
    setState((prev) =>
      moveProjectWithinSidebarFolders(prev, projectId, targetFolderId, anchorProjectId, position)
    );
  }, []);

  const moveFolderById = useCallback((
    folderId: string,
    targetFolderId: string,
    position: FolderInsertPosition,
  ) => {
    if (!hydratedRef.current) return;
    setState((prev) => moveSidebarFolder(prev, folderId, targetFolderId, position));
  }, []);

  const setFolderExpanded = useCallback((folderId: string, expanded: boolean) => {
    if (!hydratedRef.current) return;
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
    hasInitialHydration,
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
