import { useQuery } from "@tanstack/react-query";
import { api } from "./useApi";
import type { ModelCatalogResponse } from "@/types";

/** Shared model catalog (`GET /api/models`) used by the agent and automation forms. */
export function useModelCatalog() {
  return useQuery({
    queryKey: ["models"],
    queryFn: () => api.get<ModelCatalogResponse>("/api/models"),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });
}
