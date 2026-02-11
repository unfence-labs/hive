import { useCallback } from "react";
import { api } from "./useApi";
import { useResource } from "./useResource";
import type { Project } from "@/types";

export function useProjects() {
  const { data: projects, loading, error, refresh, setData } = useResource<Project>("/api/projects");

  const createProject = useCallback(async (url: string) => {
    const project = await api.post<Project>("/api/projects", { url });
    setData((prev) => [...prev, project]);
    return project;
  }, [setData]);

  const deleteProject = useCallback(async (id: string) => {
    await api.delete(`/api/projects/${id}`);
    setData((prev) => prev.filter((p) => p.id !== id));
  }, [setData]);

  return { projects, loading, error, fetchProjects: refresh, createProject, deleteProject };
}
