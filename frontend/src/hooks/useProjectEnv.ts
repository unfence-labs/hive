import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type { ProjectEnvData } from "@/types";

export function useProjectEnv(projectId: string | undefined) {
  return useQuery({
    queryKey: ["project-env", projectId],
    queryFn: () => api.get<ProjectEnvData>(`/api/projects/${projectId}/env`),
    enabled: !!projectId,
  });
}

export function useUpdateProjectEnv(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api.put<ProjectEnvData>(`/api/projects/${projectId}/env`, { content }),
    onSuccess: (data) => {
      qc.setQueryData(["project-env", projectId], data);
    },
  });
}

export function useDeleteProjectEnv(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/api/projects/${projectId}/env`),
    onSuccess: () => {
      qc.setQueryData<ProjectEnvData>(["project-env", projectId], {
        exists: false,
        content: "",
      });
    },
  });
}
