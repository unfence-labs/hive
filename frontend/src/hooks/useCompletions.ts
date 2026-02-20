import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";
import type { CompletionItem } from "@/types";

interface CompletionsResponse {
  items: CompletionItem[];
}

export function useCompletions(wsId: string | undefined): CompletionItem[] {
  const query = useQuery({
    queryKey: ["completions", wsId],
    queryFn: () =>
      api.get<CompletionsResponse>(`/api/workspaces/${wsId}/completions`),
    enabled: !!wsId,
    staleTime: 10 * 60 * 1000, // Completions rarely change
    retry: 0, // Optional UX — don't retry
  });

  return query.data?.items ?? [];
}
