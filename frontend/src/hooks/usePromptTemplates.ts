import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api } from "./useApi";
import type { PromptTemplate } from "@/types";

export function usePromptTemplates() {
  return useQuery({
    queryKey: ["prompt-templates"],
    queryFn: () => api.get<PromptTemplate[]>("/api/prompt-templates"),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useCreatePromptTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; type: "system" | "user"; content: string }) =>
      api.post<PromptTemplate>("/api/prompt-templates", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    },
  });
}

export function useUpdatePromptTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; content?: string }) =>
      api.put<PromptTemplate>(`/api/prompt-templates/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    },
  });
}

export function useDeletePromptTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/prompt-templates/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    },
  });
}
