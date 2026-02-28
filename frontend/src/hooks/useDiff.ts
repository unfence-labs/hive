import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parsePatchFiles, type ParsedPatch } from "@pierre/diffs";
import { api } from "./useApi";

interface DiffData {
  patchFiles: ParsedPatch[];
}

export function useDiff(wsId: string | undefined, enabled = false) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["diff", wsId],
    queryFn: async (): Promise<DiffData> => {
      const { diff } = await api.get<{ diff: string }>(
        `/api/workspaces/${wsId}/diff`,
      );
      return {
        patchFiles: diff ? parsePatchFiles(diff) : [],
      };
    },
    enabled: !!wsId && enabled,
    staleTime: 0, // Diff is volatile — always fetch fresh on demand
    gcTime: 2 * 60 * 1000,
  });

  return {
    patchFiles: query.data?.patchFiles ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: ["diff", wsId] }),
  };
}
