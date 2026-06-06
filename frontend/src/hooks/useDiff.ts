import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parsePatchFiles, type ParsedPatch } from "@pierre/diffs";
import { api } from "./useApi";
import { BRAIN_PARSED_DIFF_QUERY_KEY, BRAIN_WORKSPACE_ID } from "@/lib/brain";
import type { DiffScope } from "@/types";

interface DiffData {
  patchFiles: ParsedPatch[];
}

/**
 * Fetch and parse a diff for the inline viewer.
 *
 * For workspaces this fetches `/api/workspaces/:wsId/diff?scope=`. For the Brain
 * (`wsId === BRAIN_WORKSPACE_ID`) it fetches `/api/brain/diff` instead — the
 * Brain has a single working-tree scope, so `diffScope` is ignored and a
 * distinct cache key ({@link BRAIN_PARSED_DIFF_QUERY_KEY}) is used so it never
 * collides with the raw Brain diff cached for the Save review modal.
 */
export function useDiff(
  wsId: string | undefined,
  diffScope: DiffScope = "combined",
  enabled = false,
) {
  const queryClient = useQueryClient();
  const isBrain = wsId === BRAIN_WORKSPACE_ID;
  const queryKey = isBrain
    ? BRAIN_PARSED_DIFF_QUERY_KEY
    : (["diff", wsId, diffScope] as const);

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<DiffData> => {
      const url = isBrain
        ? "/api/brain/diff"
        : `/api/workspaces/${wsId}/diff?scope=${diffScope}`;
      const { diff } = await api.get<{ diff: string }>(url);
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
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  };
}
