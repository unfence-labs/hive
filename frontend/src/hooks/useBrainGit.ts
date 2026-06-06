import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import {
  BRAIN_PARSED_DIFF_QUERY_KEY,
  BRAIN_STATUS_QUERY_KEY,
} from "@/lib/brain";
import type { BrainSaveResponse, BrainStatusResponse } from "@/types";

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

/**
 * Save mutation: commits + pushes the whole working tree. On success the status
 * badge and parsed diff are invalidated so the UI reflects the now-clean tree.
 */
export function useBrainSave() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (message?: string) =>
      api.post<BrainSaveResponse>("/api/brain/save", { message }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BRAIN_STATUS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: BRAIN_PARSED_DIFF_QUERY_KEY });
    },
  });

  return {
    save: (message?: string) => mutation.mutateAsync(message),
    isSaving: mutation.isPending,
  };
}
