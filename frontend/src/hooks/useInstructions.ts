import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type { InstructionDetail, UpdateInstructionsRequest } from "@/types";

export function useInstructions() {
  return useQuery({
    queryKey: ["settings", "instructions"],
    queryFn: () => api.get<InstructionDetail>("/api/settings/instructions"),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useUpdateInstructions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateInstructionsRequest) =>
      api.put<InstructionDetail>("/api/settings/instructions", body),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "instructions"], data);
      void qc.invalidateQueries({ queryKey: ["settings", "instructions"] });
    },
  });
}

export function useSyncInstructions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<InstructionDetail>("/api/settings/instructions/sync"),
    onSuccess: (data) => {
      qc.setQueryData(["settings", "instructions"], data);
      void qc.invalidateQueries({ queryKey: ["settings", "instructions"] });
    },
  });
}

export function useDeleteInstructions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>("/api/settings/instructions"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings", "instructions"] });
    },
  });
}
