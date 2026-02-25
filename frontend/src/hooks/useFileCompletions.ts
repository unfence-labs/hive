import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";

interface FileCompletionsResponse {
  files: string[];
}

export function useFileCompletions(wsId: string | undefined): string[] {
  const query = useQuery({
    queryKey: ["file-completions", wsId],
    queryFn: () =>
      api.get<FileCompletionsResponse>(`/api/workspaces/${wsId}/file-completions`),
    enabled: !!wsId,
    staleTime: 2 * 60 * 1000,
    retry: 0,
  });

  return query.data?.files ?? [];
}
