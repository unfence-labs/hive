import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import { BRAIN_STATUS_QUERY_KEY } from "@/hooks/useBrainFiles";
import type { BrainSaveResponse, BrainStatusResponse } from "@/types";

/** Cache key for the Brain diff (working tree vs HEAD). */
export const BRAIN_DIFF_QUERY_KEY = ["brain", "diff"] as const;

/**
 * Query the Brain pending-change status — drives the Save badge count. The
 * working tree is single-editor in M-B, so invalidation on mutation is enough.
 */
export function useBrainStatus() {
  return useQuery({
    queryKey: BRAIN_STATUS_QUERY_KEY,
    queryFn: () => api.get<BrainStatusResponse>("/api/brain/status"),
  });
}

/** Query the Brain working-tree-vs-HEAD diff. Disabled until review opens. */
export function useBrainDiff(enabled: boolean) {
  return useQuery({
    queryKey: BRAIN_DIFF_QUERY_KEY,
    queryFn: () => api.get<{ diff: string }>("/api/brain/diff"),
    enabled,
    staleTime: 0, // The diff is volatile — always fetch fresh when review opens.
  });
}

/**
 * Save mutation: commits + pushes the whole working tree. On success the status
 * badge and diff are invalidated so the UI reflects the now-clean tree.
 */
export function useBrainSave() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (message?: string) =>
      api.post<BrainSaveResponse>("/api/brain/save", { message }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BRAIN_STATUS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: BRAIN_DIFF_QUERY_KEY });
    },
  });

  return {
    save: (message?: string) => mutation.mutateAsync(message),
    isSaving: mutation.isPending,
  };
}
