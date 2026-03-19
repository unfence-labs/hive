import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type { Project, Workspace } from "@/types";

export function useProjects() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.get<Project[]>("/api/projects"),
  });

  /** Shared logic: create project → optimistic cache → create workspace → rollback on error. */
  async function createProjectThenWorkspace(
    body: Record<string, unknown>,
  ): Promise<Workspace> {
    const project = await api.post<Project>("/api/projects", body);
    // Optimistically add project so Sidebar renders immediately
    queryClient.setQueryData<Project[]>(["projects"], (prev) =>
      prev ? [...prev, project] : [project],
    );
    try {
      const workspace = await api.post<Workspace>(
        `/api/projects/${project.id}/workspaces`,
      );
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.map((p) =>
          p.id !== project.id
            ? p
            : { ...p, workspaces: [...p.workspaces, workspace] },
        ) ?? [],
      );
      return workspace;
    } catch (err) {
      // Roll back: remove the project from cache and clean up backend
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.filter((p) => p.id !== project.id) ?? [],
      );
      try {
        await api.delete(`/api/projects/${project.id}`);
      } catch {
        // Best-effort cleanup
      }
      throw err;
    }
  }

  const createProjectWithWorkspace = useMutation({
    mutationFn: (url: string) => createProjectThenWorkspace({ url }),
  });

  const createNewProjectWithWorkspace = useMutation({
    mutationFn: (params: { name: string; visibility?: "public" | "private" }) =>
      createProjectThenWorkspace({ mode: "create", ...params }),
  });

  const createWorkspace = useMutation({
    mutationFn: (projectId: string) =>
      api.post<Workspace>(`/api/projects/${projectId}/workspaces`),
    onSuccess: (workspace, projectId) => {
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.map((p) =>
          p.id !== projectId
            ? p
            : { ...p, workspaces: [...p.workspaces, workspace] },
        ) ?? [],
      );
    },
  });

  const deleteProject = useMutation({
    mutationFn: (id: string) => api.delete(`/api/projects/${id}`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.filter((p) => p.id !== id) ?? [],
      );
    },
  });

  const archiveWorkspace = useMutation({
    mutationFn: (wsId: string) =>
      api.post(`/api/workspaces/${wsId}/archive`),
    onSuccess: (_, wsId) => {
      queryClient.setQueryData<Project[]>(["projects"], (prev) =>
        prev?.map((p) => ({
          ...p,
          workspaces: p.workspaces.filter((ws) => ws.id !== wsId),
        })) ?? [],
      );
    },
  });

  return {
    projects: query.data ?? [],
    loading: query.isLoading,
    error: query.error,
    fetchProjects: () =>
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
    createProjectWithWorkspace: (url: string) =>
      createProjectWithWorkspace.mutateAsync(url),
    createNewProjectWithWorkspace: (params: { name: string; visibility?: "public" | "private" }) =>
      createNewProjectWithWorkspace.mutateAsync(params),
    createWorkspace: (projectId: string) =>
      createWorkspace.mutateAsync(projectId),
    deleteProject: (id: string) => deleteProject.mutateAsync(id),
    archiveWorkspace: (wsId: string) => archiveWorkspace.mutateAsync(wsId),
  };
}
