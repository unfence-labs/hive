import { useState, useEffect, useCallback } from "react";
import { api } from "@/hooks/useApi";
import type { Workspace } from "@/types";

export function useWorkspaces(projectId: string | undefined) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async () => {
    if (!projectId) return;
    try {
      setLoading(true);
      const data = await api.get<Workspace[]>(
        `/api/projects/${projectId}/workspaces`,
      );
      setWorkspaces(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch workspaces");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const createWorkspace = useCallback(async () => {
    if (!projectId) return;
    const ws = await api.post<Workspace>(
      `/api/projects/${projectId}/workspaces`,
    );
    setWorkspaces((prev) => [...prev, ws]);
    return ws;
  }, [projectId]);

  const deleteWorkspace = useCallback(async (wsId: string) => {
    await api.delete(`/api/workspaces/${wsId}`);
    setWorkspaces((prev) => prev.filter((w) => w.id !== wsId));
  }, []);

  return { workspaces, loading, error, fetchWorkspaces, createWorkspace, deleteWorkspace };
}
