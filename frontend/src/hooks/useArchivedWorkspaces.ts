import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import { invalidateWorkspaceSources } from "./useProjects";
import type { ArchivedWorkspaceItem, Workspace } from "@/types";

/** Archived workspaces of a project for the "Restore workspace…" dialog; fetched only while it is open. */
export function useArchivedWorkspaces(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["project-archives", projectId],
    queryFn: () => api.get<ArchivedWorkspaceItem[]>(`/api/projects/${projectId}/archives`),
    enabled: enabled && !!projectId,
    // No WS event announces archives made by other clients, so refetch on every open.
    staleTime: 0,
  });
}

export function useRestoreWorkspace(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (wsId: string) => api.post<Workspace>(`/api/workspaces/${wsId}/restore`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-archives", projectId] });
      invalidateWorkspaceSources(queryClient, projectId);
    },
  });
}

export function useDeleteArchivedWorkspace(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (wsId: string) => api.delete<void>(`/api/workspaces/${wsId}/archive`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-archives", projectId] });
      invalidateWorkspaceSources(queryClient, projectId);
    },
  });
}
