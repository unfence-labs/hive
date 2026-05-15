import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type { SkillDetail, SkillListResponse, SkillSyncResponse } from "@/types";

export function useSkills() {
  return useQuery({
    queryKey: ["settings", "skills"],
    queryFn: () => api.get<SkillListResponse>("/api/settings/skills"),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useSkill(id: string | null | undefined) {
  return useQuery({
    queryKey: ["settings", "skills", id],
    queryFn: () => api.get<SkillDetail>(`/api/settings/skills/${id}`),
    enabled: Boolean(id),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useUpdateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.put<SkillDetail>(`/api/settings/skills/${id}`, { content }),
    onSuccess: (data, vars) => {
      qc.setQueryData(["settings", "skills", data.id], data);
      if (data.id !== vars.id) {
        qc.removeQueries({ queryKey: ["settings", "skills", vars.id] });
      }
      void qc.invalidateQueries({ queryKey: ["settings", "skills"] });
    },
  });
}

export function useSyncSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SkillDetail>(`/api/settings/skills/${id}/sync`),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "skills", data.id], data);
      void qc.invalidateQueries({ queryKey: ["settings", "skills"] });
    },
  });
}

export function useSyncMissingSkills() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<SkillSyncResponse>("/api/settings/skills/sync-missing"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "skills"] });
    },
  });
}
