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
};

export function useModels(lockedProvider?: string): UseModelsReturn {
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [defaultModelId, setDefaultModelId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // Track latest lockedProvider so the API callback reads the current value,
  // not the one captured at mount time (which is often undefined).
  const lockedProviderRef = useRef(lockedProvider);
  lockedProviderRef.current = lockedProvider;

  useEffect(() => {
    let cancelled = false;
    api.get<ModelCatalogResponse>("/api/models")
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setDefaultModelId(data.defaultModelId);
        setSelectedModelId((prev) => {
          if (prev) return prev;
          const lp = lockedProviderRef.current;
          if (lp) {
            const providerDefault = data.models.find((m) => m.provider === lp && m.isDefault)
              ?? data.models.find((m) => m.provider === lp);
            if (providerDefault) return providerDefault.id;
          }
          return data.defaultModelId;
        });
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => { cancelled = true; };
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
