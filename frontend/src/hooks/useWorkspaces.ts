import { useCallback } from "react";
import { api } from "./useApi";
import { useResource } from "./useResource";
import type { Workspace } from "@/types";

export function useWorkspaces(projectId: string | undefined) {
  const url = projectId ? `/api/projects/${projectId}/workspaces` : null;
  const { data: workspaces, loading, error, refresh, setData } = useResource<Workspace>(url);

  const createWorkspace = useCallback(async () => {
    if (!projectId) return;
    const ws = await api.post<Workspace>(`/api/projects/${projectId}/workspaces`);
    setData((prev) => [...prev, ws]);
    return ws;
  }, [projectId, setData]);

  const deleteWorkspace = useCallback(async (wsId: string) => {
    await api.delete(`/api/workspaces/${wsId}`);
    setData((prev) => prev.filter((w) => w.id !== wsId));
  }, [setData]);

  return { workspaces, loading, error, fetchWorkspaces: refresh, createWorkspace, deleteWorkspace };
}
