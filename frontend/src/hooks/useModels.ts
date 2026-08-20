import { useEffect, useState } from "react";
import {
  queryOptions,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/hooks/useApi";
import type { ModelCatalogEntry, ModelCatalogResponse, ProviderCapabilities } from "@/types";

interface UseModelsReturn {
  models: ModelCatalogEntry[];
  defaultModelId: string;
  selectedModelId: string;
  selectedModel: ModelCatalogEntry | undefined;
  capabilities: ProviderCapabilities | undefined;
  setSelectedModelId: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  retry: () => void;
}

const FALLBACK_CAPABILITIES: ProviderCapabilities = {
  thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  planMode: true,
  blockingTools: true,
  completions: true,
  goals: false,
};

export const MODEL_CATALOG_QUERY_KEY = ["models", "catalog"] as const;

export function modelCatalogQueryOptions() {
  return queryOptions({
    queryKey: MODEL_CATALOG_QUERY_KEY,
    queryFn: ({ signal }) =>
      api.get<ModelCatalogResponse>("/api/models", { signal }),
  });
}

/** Warm the shared catalog without mounting a composer. */
export function prefetchModelCatalog(queryClient: QueryClient): Promise<void> {
  return queryClient.prefetchQuery(modelCatalogQueryOptions());
}

/** Refetch after an action that can change which models the server exposes.
 * Keep existing data when the refresh fails; the query records the error and
 * the composer can offer a direct retry. */
export async function refreshModelCatalog(queryClient: QueryClient): Promise<void> {
  try {
    if (queryClient.getQueryState(MODEL_CATALOG_QUERY_KEY)) {
      await queryClient.refetchQueries(
        { queryKey: MODEL_CATALOG_QUERY_KEY, exact: true, type: "all" },
        { throwOnError: true },
      );
    } else {
      await queryClient.fetchQuery(modelCatalogQueryOptions());
    }
  } catch {
    // The server-side action already succeeded. A catalog refresh failure must
    // not report that action as failed or discard the last usable catalog.
  }
}

/** Settings saved a new global default: update the shared catalog immediately. */
export function setCachedDefaultModelId(
  queryClient: QueryClient,
  defaultModelId: string,
): void {
  queryClient.setQueryData<ModelCatalogResponse>(
    MODEL_CATALOG_QUERY_KEY,
    (catalog) => catalog ? { ...catalog, defaultModelId } : catalog,
  );
}

/** Pick the initial model: caller's preferred id (if valid for the locked
 * provider), else the locked provider's default, else the global default. */
function seedModelId(
  catalog: ModelCatalogResponse,
  lockedProvider: string | undefined,
  preferredModelId: string | undefined,
): string {
  if (preferredModelId) {
    const match = catalog.models.find(
      (model) =>
        model.id === preferredModelId &&
        (!lockedProvider || model.provider === lockedProvider),
    );
    if (match) return match.id;
  }
  if (lockedProvider) {
    const providerDefault =
      catalog.models.find(
        (model) => model.provider === lockedProvider && model.isDefault,
      ) ?? catalog.models.find((model) => model.provider === lockedProvider);
    if (providerDefault) return providerDefault.id;
  }
  return catalog.defaultModelId;
}

export function useModels(
  lockedProvider?: string,
  preferredModelId?: string,
): UseModelsReturn {
  const catalogQuery = useQuery(modelCatalogQueryOptions());
  const catalog = catalogQuery.data;
  const models = catalog?.models ?? [];
  const defaultModelId = catalog?.defaultModelId ?? "";
  const [selectedModelId, setSelectedModelId] = useState(() =>
    catalog ? seedModelId(catalog, lockedProvider, preferredModelId) : "",
  );

  useEffect(() => {
    if (!catalog) return;
    setSelectedModelId((current) => {
      const selected = catalog.models.find((model) => model.id === current);
      if (selected && (!lockedProvider || selected.provider === lockedProvider)) {
        return current;
      }
      return seedModelId(catalog, lockedProvider, preferredModelId);
    });
  }, [catalog, lockedProvider, preferredModelId]);

  const selectedModel = models.find(
    (model) =>
      model.id === selectedModelId &&
      (!lockedProvider || model.provider === lockedProvider),
  );
  const capabilities =
    selectedModel?.capabilities ??
    (models.length > 0 ? undefined : FALLBACK_CAPABILITIES);

  return {
    models,
    defaultModelId,
    selectedModelId,
    selectedModel,
    capabilities,
    setSelectedModelId,
    isLoading: catalogQuery.isPending,
    isError: catalogQuery.isError,
    retry: () => { void catalogQuery.refetch(); },
  };
}
