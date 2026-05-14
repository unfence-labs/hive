import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import { EMPTY_PROJECT_ENV_CONFIG, type ProjectEnvConfig, type ProjectEnvData } from "@hive/shared/project-env";

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
    mutationFn: (config: ProjectEnvConfig) =>
      api.put<ProjectEnvData>(`/api/projects/${projectId}/env`, { config }),
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
        config: EMPTY_PROJECT_ENV_CONFIG,
      });
    },
  });
}
