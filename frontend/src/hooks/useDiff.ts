import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parsePatchFiles, type ParsedPatch } from "@pierre/diffs";
import { api } from "./useApi";
import { BRAIN_PARSED_DIFF_QUERY_KEY, BRAIN_WORKSPACE_ID } from "@/lib/brain";
import type { DiffScope } from "@/types";

interface DiffData {
  patchFiles: ParsedPatch[];
  omittedFileCount: number;
}

/**
 * Fetch and parse a diff for the inline viewer.
 *
 * For workspaces this fetches `/api/workspaces/:wsId/diff?scope=`. For the Brain
 * (`wsId === BRAIN_WORKSPACE_ID`) it fetches `/api/brain/diff` instead — the
 * Brain has a single working-tree scope, so `diffScope` is ignored and the
 * distinct cache key ({@link BRAIN_PARSED_DIFF_QUERY_KEY}) is used.
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
      const { diff, omittedFileCount = 0 } = await api.get<{
        diff: string;
        omittedFileCount?: number;
      }>(url);
      return {
        patchFiles: diff ? parsePatchFiles(diff) : [],
        omittedFileCount,
      };
    },
    enabled: !!wsId && enabled,
    staleTime: 0, // Diff is volatile — always fetch fresh on demand
    gcTime: 2 * 60 * 1000,
  });

  return {
    patchFiles: query.data?.patchFiles ?? [],
    omittedFileCount: query.data?.omittedFileCount ?? 0,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  };
}
