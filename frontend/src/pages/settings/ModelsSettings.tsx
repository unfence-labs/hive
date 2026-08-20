import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Eye, EyeOff, Loader2, Save } from "lucide-react";
import { SettingsHeader } from "@/components/AppLayout";
import { CenterCard } from "@/components/CenterCard";
import { SettingsPanel, SettingsSection } from "@/components/settings/SettingsSection";
import { ProviderIcon } from "@/components/chat/ProviderIcon";
import { groupModelsByProvider } from "@/components/chat/ModelSelector";
import { Input } from "@/components/ui/input";
import { api } from "@/hooks/useApi";
import { useModels, refreshModelCatalog, setCachedDefaultModelId } from "@/hooks/useModels";
import { PROVIDER_USAGE_QUERY_KEY } from "@/hooks/useProviderUsage";
import { cn } from "@/lib/utils";

export default function ModelsSettings() {
  const queryClient = useQueryClient();
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
      setCachedDefaultModelId(queryClient, modelId);
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
        <SettingsPanel>
          <SettingsSection
            title="Default model"
            description="Used when starting a new conversation. You can still switch models from the composer at any time."
          >
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
          </SettingsSection>

          <KimiSection />
        </SettingsPanel>
      </CenterCard>
    </div>
  );
}

function KimiSection() {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);
  // Gate the form on the initial GET: rendering an empty input over a stored
  // key would let a single Save silently wipe the credential.
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    api.get<{ apiKey: string }>("/api/settings/kimi")
      .then((data) => {
        if (cancelled) return;
        setApiKey(data.apiKey ?? "");
        setLoadState("loaded");
      })
      .catch(() => { if (!cancelled) setLoadState("error"); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await api.put<{ apiKey: string }>("/api/settings/kimi", { apiKey });
      setApiKey(saved.apiKey);
      setFeedback("saved");
      void queryClient.invalidateQueries({ queryKey: PROVIDER_USAGE_QUERY_KEY });
      // The key gates the Kimi models server-side: refetch so they
      // appear/disappear without a reload.
      await refreshModelCatalog(queryClient);
    } catch {
      setFeedback("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsSection
      title="Kimi"
      description={
        <>
          API key from the{" "}
          <a
            href="https://www.kimi.com/code/console"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            Kimi Code console
          </a>
          , used to enable the Kimi provider.
        </>
      }
    >
      {loadState === "loading" && (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading saved key…
        </div>
      )}

      {loadState === "error" && (
        <p className="py-4 text-xs text-destructive">
          Could not load the saved API key. Reload the page to try again.
        </p>
      )}

      {loadState === "loaded" && (
        <>
          <div className="mt-4">
            <label htmlFor="kimi-api-key" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Kimi API key
            </label>
            <div className="relative">
              <Input
                id="kimi-api-key"
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setFeedback(null); }}
                placeholder="sk-..."
                className="pr-9 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showKey
                  ? <EyeOff className="h-3.5 w-3.5" />
                  : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90",
                saving && "pointer-events-none opacity-60",
              )}
            >
              {saving
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Save className="h-3 w-3" />}
              Save
            </button>

            {feedback && (
              <span className={cn(
                "text-xs font-medium",
                feedback === "saved" ? "text-success-foreground" : "text-destructive",
              )}>
                {feedback === "saved" ? "Saved" : "Failed to save"}
              </span>
            )}
          </div>
        </>
      )}
    </SettingsSection>
  );
}
