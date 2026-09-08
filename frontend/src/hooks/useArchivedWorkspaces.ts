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
    mutationFn: async (wsId: string) => {
      const workspace = await api.post<Workspace>(`/api/workspaces/${wsId}/restore`);
      // The picker keeps its row spinner until this settles, so land the
      // sidebar row and warm the workspace view before the dialog closes.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.prefetchQuery({
          queryKey: ["workspace", workspace.id],
          queryFn: () => api.get<Workspace>(`/api/workspaces/${workspace.id}`),
        }),
      ]);
      return workspace;
    },
    onSuccess: () => {
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
