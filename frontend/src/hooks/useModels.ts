import { useEffect, useRef, useState } from "react";
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
}

const FALLBACK_CAPABILITIES: ProviderCapabilities = {
  thinkingLevels: ["low", "medium", "high", "xhigh", "max"],
  planMode: true,
  blockingTools: true,
  completions: true,
  goals: false,
};

// Module-level catalog cache. The model catalog is global and effectively
// static for a session, so caching it lets ChatInput be remounted per session
// (key={wsId:sessionId}) without re-fetching /api/models or flashing an empty
// model selector — the states below seed synchronously from the cache.
let catalogCache: ModelCatalogResponse | null = null;
let catalogPromise: Promise<ModelCatalogResponse> | null = null;

/** Mounted useModels hooks, notified when refreshModelCatalog refetches. */
const catalogListeners = new Set<(data: ModelCatalogResponse) => void>();

/** Test-only: clear the module-level catalog cache so cases stay isolated. */
export function __resetModelCatalogCacheForTests(): void {
  catalogCache = null;
  catalogPromise = null;
}

/** Drop the cache and refetch the catalog, pushing the result to every mounted
 *  useModels hook. Used when the server-side catalog changes at runtime (e.g.
 *  saving a Kimi API key adds/removes its models). Keeps the old catalog on
 *  fetch failure. */
export async function refreshModelCatalog(): Promise<void> {
  catalogCache = null;
  catalogPromise = null;
  try {
    const data = await loadCatalog();
    catalogListeners.forEach((listener) => listener(data));
  } catch {
    // Keep whatever the hooks already show; the next mount retries.
  }
}

/** Settings saved a new global default: patch the cached catalog so composers
 *  mounted after this seed with it without a page reload. */
export function setCachedDefaultModelId(defaultModelId: string): void {
  if (catalogCache) {
    catalogCache = { ...catalogCache, defaultModelId };
  }
}

function loadCatalog(): Promise<ModelCatalogResponse> {
  if (!catalogPromise) {
    catalogPromise = api.get<ModelCatalogResponse>("/api/models")
      .then((data) => { catalogCache = data; return data; })
      .catch((err) => { catalogPromise = null; throw err; });
  }
  return catalogPromise;
}

/** Pick the initial model: caller's preferred id (if valid for the locked
 *  provider), else the locked provider's default, else the global default. */
function seedModelId(
  catalog: ModelCatalogResponse,
  lockedProvider: string | undefined,
  preferredModelId: string | undefined,
): string {
  if (preferredModelId) {
    const match = catalog.models.find(
      (m) => m.id === preferredModelId && (!lockedProvider || m.provider === lockedProvider),
    );
    if (match) return match.id;
  }
  if (lockedProvider) {
    const providerDefault = catalog.models.find((m) => m.provider === lockedProvider && m.isDefault)
      ?? catalog.models.find((m) => m.provider === lockedProvider);
    if (providerDefault) return providerDefault.id;
  }
  return catalog.defaultModelId;
}

export function useModels(lockedProvider?: string, preferredModelId?: string): UseModelsReturn {
  const [models, setModels] = useState<ModelCatalogEntry[]>(() => catalogCache?.models ?? []);
  const [defaultModelId, setDefaultModelId] = useState(() => catalogCache?.defaultModelId ?? "");
  const [selectedModelId, setSelectedModelId] = useState(() =>
    catalogCache ? seedModelId(catalogCache, lockedProvider, preferredModelId) : "");
  const [isLoading, setIsLoading] = useState(!catalogCache);

  // Track latest values so the async seed reads current props, not the ones
  // captured at mount time (lockedProvider is often undefined on first render).
  const lockedProviderRef = useRef(lockedProvider);
  lockedProviderRef.current = lockedProvider;
  const preferredModelIdRef = useRef(preferredModelId);
  preferredModelIdRef.current = preferredModelId;

  useEffect(() => {
    if (catalogCache) return; // already seeded synchronously from cache
    let cancelled = false;
    loadCatalog()
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setDefaultModelId(data.defaultModelId);
        setSelectedModelId((prev) =>
          prev || seedModelId(data, lockedProviderRef.current, preferredModelIdRef.current));
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Follow runtime catalog refreshes (refreshModelCatalog) while mounted.
  useEffect(() => {
    const listener = (data: ModelCatalogResponse) => {
      setModels(data.models);
      setDefaultModelId(data.defaultModelId);
      // Keep the current selection when it survives the refresh; reseed otherwise.
      setSelectedModelId((prev) =>
        prev && data.models.some((m) => m.id === prev)
          ? prev
          : seedModelId(data, lockedProviderRef.current, preferredModelIdRef.current));
      setIsLoading(false);
    };
    catalogListeners.add(listener);
    return () => { catalogListeners.delete(listener); };
  }, []);

  const selectedModel = models.find((m) => m.id === selectedModelId);
  const capabilities = selectedModel?.capabilities ?? (models.length > 0 ? undefined : FALLBACK_CAPABILITIES);

  return {
    models,
    defaultModelId,
    selectedModelId,
    selectedModel,
    capabilities,
    setSelectedModelId,
    isLoading,
  };
}
