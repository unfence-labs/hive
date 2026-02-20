import { useEffect, useState } from "react";
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
  thinking: true,
  planMode: true,
  blockingTools: true,
};

export function useModels(): UseModelsReturn {
  const [models, setModels] = useState<ModelCatalogEntry[]>([]);
  const [defaultModelId, setDefaultModelId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get<ModelCatalogResponse>("/api/models")
      .then((data) => {
        if (cancelled) return;
        setModels(data.models);
        setDefaultModelId(data.defaultModelId);
        // Only set if no model was previously selected
        setSelectedModelId((prev) => prev || data.defaultModelId);
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
