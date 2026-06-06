import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./useApi";
import type { BasePromptData } from "@/types";

/**
 * Hooks for an editable prompt resource backed by a `{ content, isDefault,
 * defaultContent }` REST endpoint with `GET`/`PUT`/`DELETE` semantics (the
 * shape shared by `/api/prompts/base` and `/api/prompts/brain`).
 */
export interface PromptResourceHooks {
  usePrompt: () => ReturnType<typeof useQuery<BasePromptData>>;
  useUpdatePrompt: () => ReturnType<
    typeof useMutation<BasePromptData, Error, string>
  >;
  useResetPrompt: () => ReturnType<typeof useMutation<unknown, Error, void>>;
}

/**
 * Builds a set of query/mutation hooks for a prompt resource so that base and
 * brain prompts share one implementation instead of duplicating hook bodies.
 *
 * @param queryKey TanStack Query key for the resource (e.g. `["base-prompt"]`).
 * @param endpoint REST endpoint backing the resource (e.g. `/api/prompts/base`).
 */
export function makePromptResource(
  queryKey: readonly unknown[],
  endpoint: string,
): PromptResourceHooks {
  const usePrompt = () =>
    useQuery({
      queryKey,
      queryFn: () => api.get<BasePromptData>(endpoint),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    });

  const useUpdatePrompt = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: (content: string) =>
        api.put<BasePromptData>(endpoint, { content }),
      onSuccess: (data) => {
        qc.setQueryData(queryKey, data);
      },
    });
  };

  const useResetPrompt = () => {
    const qc = useQueryClient();
    return useMutation({
      mutationFn: () => api.delete(endpoint),
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey });
      },
    });
  };

  return { usePrompt, useUpdatePrompt, useResetPrompt };
}
