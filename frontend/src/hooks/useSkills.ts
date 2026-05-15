import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type {
  CreateSkillRequest,
  SkillDetail,
  SkillListResponse,
  SkillSyncResponse,
  UpdateSkillRequest,
} from "@/types";

function upsertSkillInList(
  current: SkillListResponse | undefined,
  skill: SkillDetail,
  replacedId?: string,
): SkillListResponse | undefined {
  if (!current) return current;
  const skills = current.skills
    .filter((item) => item.id !== skill.id && item.id !== replacedId)
    .concat(skill)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ...current, skills };
}

function removeSkillFromList(
  current: SkillListResponse | undefined,
  id: string,
): SkillListResponse | undefined {
  if (!current) return current;
  return {
    ...current,
    skills: current.skills.filter((item) => item.id !== id),
  };
}

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
    mutationFn: ({ id, content }: { id: string } & UpdateSkillRequest) =>
      api.put<SkillDetail>(`/api/settings/skills/${id}`, { content }),
    onSuccess: (data, vars) => {
      qc.setQueryData(["settings", "skills", data.id], data);
      qc.setQueryData<SkillListResponse>(["settings", "skills"], (current) =>
        upsertSkillInList(current, data, vars.id),
      );
      if (data.id !== vars.id) {
        qc.removeQueries({ queryKey: ["settings", "skills", vars.id] });
      }
      void qc.invalidateQueries({ queryKey: ["settings", "skills"] });
    },
  });
}

export function useCreateSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillRequest) =>
      api.post<SkillDetail>("/api/settings/skills", body),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "skills", data.id], data);
      qc.setQueryData<SkillListResponse>(["settings", "skills"], (current) =>
        upsertSkillInList(current, data),
      );
      void qc.invalidateQueries({ queryKey: ["settings", "skills"] });
    },
  });
}

export function useSyncSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<SkillDetail>(`/api/settings/skills/${id}/sync`),
    onSuccess: (data, id) => {
      qc.setQueryData(["settings", "skills", data.id], data);
      qc.setQueryData<SkillListResponse>(["settings", "skills"], (current) =>
        upsertSkillInList(current, data, id),
      );
      void qc.invalidateQueries({ queryKey: ["settings", "skills"] });
    },
  });
}

export function useDeleteSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/settings/skills/${id}`),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ["settings", "skills", id] });
      qc.setQueryData<SkillListResponse>(["settings", "skills"], (current) =>
        removeSkillFromList(current, id),
      );
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
