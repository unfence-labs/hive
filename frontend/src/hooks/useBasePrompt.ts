import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type { BasePromptData } from "@/types";

export function useBasePrompt() {
  return useQuery({
    queryKey: ["base-prompt"],
    queryFn: () => api.get<BasePromptData>("/api/prompts/base"),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
}

export function useUpdateBasePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) =>
      api.put<BasePromptData>("/api/prompts/base", { content }),
    onSuccess: (data) => {
      qc.setQueryData(["base-prompt"], data);
    },
  });
}

export function useResetBasePrompt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/api/prompts/base"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["base-prompt"] });
    },
  });
}
