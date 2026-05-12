import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type { ProjectEnvData } from "@/types";

const projectEnvQueryKey = (projectId: string | undefined) => ["project-env", projectId] as const;

export function useProjectEnv(projectId: string | undefined) {
  return useQuery({
    queryKey: projectEnvQueryKey(projectId),
    queryFn: () => api.get<ProjectEnvData>(`/api/projects/${projectId}/env`),
    enabled: !!projectId,
  });
}

export function useUpdateProjectEnv(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api.put<ProjectEnvData>(`/api/projects/${projectId}/env`, { content }),
    onSuccess: (data) => {
      qc.setQueryData(projectEnvQueryKey(projectId), data);
    },
  });
}

export function useDeleteProjectEnv(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/api/projects/${projectId}/env`),
    onSuccess: () => {
      qc.setQueryData<ProjectEnvData>(projectEnvQueryKey(projectId), {
        exists: false,
        content: "",
      });
    },
  });
}
