import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";
import type { CompletionItem } from "@/types";

interface CompletionsResponse {
  items: CompletionItem[];
}

export function useCompletions(
  wsId: string | undefined,
  provider: string | undefined,
): CompletionItem[] {
  const query = useQuery({
    queryKey: ["completions", wsId, provider ?? "claude"],
    queryFn: () =>
      api.get<CompletionsResponse>(
        `/api/workspaces/${wsId}/completions?provider=${encodeURIComponent(provider ?? "claude")}`,
      ),
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000, // Completions rarely change
    retry: 0, // Optional UX — don't retry
  });

  return query.data?.items ?? [];
}
