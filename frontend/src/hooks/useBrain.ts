import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { BrainState } from "@/types";

/** React Query cache key for the singleton Brain state. */
const BRAIN_QUERY_KEY = ["brain"] as const;

export interface CreateBrainInput {
  /** GitHub repository name to create for the Brain. */
  name: string;
}

export interface ConnectBrainInput {
  /** Existing Git repository URL to use as the Brain normal clone origin. */
  url: string;
}

/** TanStack Query helpers for the singleton Brain repository. */
export function useBrain() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: BRAIN_QUERY_KEY,
    queryFn: () => api.get<BrainState>("/api/brain"),
  });

  const createBrain = useMutation({
    mutationFn: ({ name }: CreateBrainInput) =>
      api.post<Extract<BrainState, { exists: true }>>("/api/brain", {
        mode: "create",
        name,
    }),
    onSuccess: (state) => {
      queryClient.setQueryData(BRAIN_QUERY_KEY, state);
    },
  });

  const connectBrain = useMutation({
    mutationFn: ({ url }: ConnectBrainInput) =>
      api.post<Extract<BrainState, { exists: true }>>("/api/brain", {
        mode: "connect",
        url,
    }),
    onSuccess: (state) => {
      queryClient.setQueryData(BRAIN_QUERY_KEY, state);
    },
  });

  const deleteBrain = useMutation({
    mutationFn: () => api.delete<void>("/api/brain"),
    onSuccess: () => {
      queryClient.setQueryData<BrainState>(BRAIN_QUERY_KEY, { exists: false });
    },
  });

  return {
    brain: query.data ?? { exists: false },
    loading: query.isLoading,
    error: query.error,
    createBrain: (input: CreateBrainInput) => createBrain.mutateAsync(input),
    connectBrain: (input: ConnectBrainInput) => connectBrain.mutateAsync(input),
    deleteBrain: () => deleteBrain.mutateAsync(),
  };
}
