import { useCallback } from "react";
import { api } from "./useApi";
import { useResource } from "./useResource";
import type { Project, Workspace } from "@/types";

export function useProjects() {
  const { data: projects, loading, error, refresh, setData } = useResource<Project>("/api/projects");

  const createProject = useCallback(async (url: string) => {
    const project = await api.post<Project>("/api/projects", { url });
    setData((prev) => [...prev, project]);
    return project;
  }, [setData]);

  const createWorkspace = useCallback(async (projectId: string) => {
    const workspace = await api.post<Workspace>(`/api/projects/${projectId}/workspaces`);
    setData((prev) => prev.map((project) => {
      if (project.id !== projectId) return project;
      return { ...project, workspaces: [...project.workspaces, workspace] };
    }));
    return workspace;
  }, [setData]);

  const deleteProject = useCallback(async (id: string) => {
    await api.delete(`/api/projects/${id}`);
    setData((prev) => prev.filter((p) => p.id !== id));
  }, [setData]);

  return {
    projects,
    loading,
    error,
    fetchProjects: refresh,
    createProject,
    createWorkspace,
    deleteProject,
  };
}
