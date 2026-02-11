import { useState, useEffect, useCallback } from "react";
import { api } from "@/hooks/useApi";
import type { Project } from "@/types";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<Project[]>("/api/projects");
      setProjects(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const createProject = useCallback(
    async (url: string) => {
      const project = await api.post<Project>("/api/projects", { url });
      setProjects((prev) => [...prev, project]);
      return project;
    },
    [],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await api.delete(`/api/projects/${id}`);
      setProjects((prev) => prev.filter((p) => p.id !== id));
    },
    [],
  );

  return { projects, loading, error, fetchProjects, createProject, deleteProject };
}
