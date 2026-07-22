import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";
import type { ProjectBranchItem, ProjectIssueItem, ProjectPullItem } from "@/types";

const SOURCES_STALE_TIME_MS = 30_000;

/** Lists for the "New workspace from…" picker; fetched only while it is open. */
export function useWorkspaceSources(projectId: string | undefined, enabled: boolean) {
  const branches = useQuery({
    queryKey: ["project-branches", projectId],
    queryFn: () => api.get<{ branches: ProjectBranchItem[] }>(`/api/projects/${projectId}/branches`),
    enabled: enabled && !!projectId,
    staleTime: SOURCES_STALE_TIME_MS,
  });
  const pulls = useQuery({
    queryKey: ["project-pulls", projectId],
    queryFn: () => api.get<{ pulls: ProjectPullItem[]; error?: string }>(`/api/projects/${projectId}/pulls`),
    enabled: enabled && !!projectId,
    staleTime: SOURCES_STALE_TIME_MS,
  });
  const issues = useQuery({
    queryKey: ["project-issues", projectId],
    queryFn: () => api.get<{ issues: ProjectIssueItem[]; error?: string }>(`/api/projects/${projectId}/issues`),
    enabled: enabled && !!projectId,
    staleTime: SOURCES_STALE_TIME_MS,
  });
  return { branches, pulls, issues };
}
