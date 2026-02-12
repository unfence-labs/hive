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

  const createProjectWithWorkspace = useCallback(async (url: string) => {
    const project = await api.post<Project>("/api/projects", { url });
    setData((prev) => [...prev, project]);

    try {
      const workspace = await api.post<Workspace>(`/api/projects/${project.id}/workspaces`);
      setData((prev) => prev.map((existing) => {
        if (existing.id !== project.id) return existing;
        return { ...existing, workspaces: [...existing.workspaces, workspace] };
      }));
      return workspace;
    } catch (error) {
      setData((prev) => prev.filter((existing) => existing.id !== project.id));
      try {
        await api.delete(`/api/projects/${project.id}`);
      } catch {
        // Best-effort cleanup on backend; local rollback already applied.
      }
      throw error;
    }
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
    createProjectWithWorkspace,
    deleteProject,
  };
}
