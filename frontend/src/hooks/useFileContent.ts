import { useQuery } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import { BRAIN_WORKSPACE_ID, brainFileQueryKey } from "@/lib/brain";

/** Normalized result returned by {@link useFileContent}. */
export interface FileContentResult {
  /** The file's text content, or `undefined` while loading / when disabled. */
  content: string | undefined;
  /** Whether the underlying fetch is in flight. */
  isLoading: boolean;
  /** The fetch error, or `null` when there is none. */
  error: Error | null;
  /** `true` when `content` is a bounded prefix of a larger file (Brain only). */
  truncated: boolean;
}

/**
 * Fetch a single file's text content for either a workspace or the Brain repo,
 * normalizing the two endpoints behind one hook.
 *
 * Resolution rules (kept identical to the previous per-surface hooks so cache
 * keys + invalidation stay compatible):
 *  - `wsId === "brain"`: queries `GET /api/brain/file?path=…` under the
 *    `brainFileQueryKey(filePath)` key with `staleTime: Infinity` (disk is the
 *    source of truth; updates are driven explicitly).
 *  - otherwise: queries `GET /api/workspaces/:wsId/file?path=…` under the
 *    `["file", wsId, filePath]` key with a 2-minute `staleTime`.
 *
 * The fetch is disabled until both `wsId` and `filePath` are present.
 */
export function useFileContent(
  wsId: string | undefined,
  filePath: string | null,
): FileContentResult {
  const isBrain = wsId === BRAIN_WORKSPACE_ID;

  const query = useQuery({
    queryKey: isBrain
      ? brainFileQueryKey(filePath)
      : (["file", wsId, filePath] as const),
    queryFn: () => {
      const url = isBrain
        ? `/api/brain/file?path=${encodeURIComponent(filePath ?? "")}`
        : `/api/workspaces/${wsId}/file?path=${encodeURIComponent(filePath ?? "")}`;
      return api.get<{ content: string; path: string; truncated?: boolean }>(url);
    },
    enabled: !!wsId && !!filePath,
    staleTime: isBrain ? Infinity : 2 * 60 * 1000,
  });

  return {
    content: query.data?.content,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    truncated: query.data?.truncated ?? false,
  };
}
