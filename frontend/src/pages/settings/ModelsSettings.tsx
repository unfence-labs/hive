import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { ProviderIcon } from "@/components/chat/ProviderIcon";
import { groupModelsByProvider } from "@/components/chat/ModelSelector";
import { api } from "@/hooks/useApi";
import { useModels, setCachedDefaultModelId } from "@/hooks/useModels";
import { cn } from "@/lib/utils";

export default function ModelsSettings() {
  const { models, defaultModelId, isLoading } = useModels();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const currentId = savedId ?? defaultModelId;

  const grouped = useMemo(() => groupModelsByProvider(models), [models]);

  const selectDefault = async (modelId: string) => {
    if (modelId === currentId) return;
    const previous = currentId;
    setSavedId(modelId);
    setSaveFailed(false);
    try {
      await api.put("/api/settings/defaults", { defaultModelId: modelId });
      setCachedDefaultModelId(modelId);
    } catch {
      setSavedId(previous);
      setSaveFailed(true);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <SettingsHeader>
        <h1 className="text-sm font-medium">Models</h1>
      </SettingsHeader>

      <CenterCard scroll>
      <div className="max-w-2xl space-y-5 px-4 py-5">
        <section>
          <div className="rounded-lg border border-border/50 bg-card/50 p-5">
            <h2 className="text-sm font-medium text-foreground">Default model</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Used when starting a new conversation. You can still switch models
              from the composer at any time.
            </p>

            {isLoading && (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading models…
              </div>
            )}

            {!isLoading && models.length === 0 && (
              <p className="py-4 text-xs text-muted-foreground">
                No agent CLI detected on this server.
              </p>
            )}

            <div role="radiogroup" aria-label="Default model" className="mt-4 space-y-4">
              {grouped.map((group) => (
                <div key={group.provider}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <ProviderIcon provider={group.provider} className="size-3 text-muted-foreground" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {group.providerLabel}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {group.models.map((model) => {
                      const isActive = model.id === currentId;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          role="radio"
                          aria-checked={isActive}
                          onClick={() => void selectDefault(model.id)}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-all duration-200",
                            isActive
                              ? "border-primary/40 bg-primary/8 text-foreground"
                              : "border-border/50 bg-transparent text-muted-foreground hover:border-border hover:bg-muted/40 hover:text-foreground",
                          )}
                        >
                          <span className="flex-1">{model.label}</span>
                          {isActive && <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {saveFailed && (
              <p className="mt-3 text-xs text-destructive">
                Could not save the default model. Please try again.
              </p>
            )}
          </div>
        </section>
      </div>
      </CenterCard>
    </div>
  );
}
