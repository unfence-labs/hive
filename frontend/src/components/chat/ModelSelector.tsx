import { useMemo } from "react";
import { CheckIcon, SparklesIcon, StarIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import type { ModelCatalogEntry } from "@/types";
import { cn } from "@/lib/utils";

/** Provider icon: Anthropic asterisk for Claude, OpenAI swirl for Codex. */
function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  if (provider === "codex") {
    return (
      <svg className={cn("size-3.5", className)} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    );
  }
  // Claude: use sparkles as a proxy for the Anthropic asterisk
  return <SparklesIcon className={cn("size-3.5", className)} />;
}

interface ModelSelectorProps {
  models: ModelCatalogEntry[];
  selectedModelId: string;
  defaultModelId: string;
  onSelect: (modelId: string) => void;
  lockedProvider?: string;
}

export function ModelSelector({ models, selectedModelId, defaultModelId, onSelect, lockedProvider }: ModelSelectorProps) {
  const selected = models.find((m) => m.id === selectedModelId);
  const label = selected?.label ?? "Select model";

  const grouped = useMemo(() => {
    const map = new Map<string, { providerLabel: string; provider: string; models: ModelCatalogEntry[] }>();
    for (const model of models) {
      const existing = map.get(model.provider);
      if (existing) {
        existing.models.push(model);
      } else {
        map.set(model.provider, { providerLabel: model.providerLabel, provider: model.provider, models: [model] });
      }
    }
    return Array.from(map.values());
  }, [models]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton aria-label={`Model: ${label}`} variant="ghost" size="xs" className="h-5 text-[11px] gap-1">
          <ProviderIcon provider={selected?.provider ?? "claude"} className="size-3" />
          {label}
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-64">
        <TooltipProvider>
          {grouped.map((group, groupIdx) => {
            const isGroupLocked = !!lockedProvider && group.provider !== lockedProvider;
            return (
              <div key={group.provider}>
                {groupIdx > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className={cn(
                  "text-[11px] text-muted-foreground/60 uppercase tracking-wider font-normal",
                  isGroupLocked && "opacity-40",
                )}>
                  {group.providerLabel}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {group.models.map((model) => {
                    const isSelected = model.id === selectedModelId;
                    const isDefault = model.id === defaultModelId;
                    const isLocked = !!lockedProvider && model.provider !== lockedProvider;

                    if (isLocked) {
                      return (
                        <Tooltip key={model.id}>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 px-2 py-1.5 text-sm opacity-40 cursor-not-allowed select-none">
                              <ProviderIcon provider={model.provider} className="size-3.5 shrink-0" />
                              <span className="flex-1">{model.label}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            Cannot switch provider mid-session
                          </TooltipContent>
                        </Tooltip>
                      );
                    }

                    return (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => onSelect(model.id)}
                        className={cn("gap-2", isSelected && "bg-accent/50")}
                      >
                        <ProviderIcon provider={model.provider} className="size-3.5 shrink-0" />
                        <span className="flex-1">{model.label}</span>
                        {model.isNew && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            NEW
                          </span>
                        )}
                        {isDefault && !isSelected && (
                          <StarIcon className="size-3 text-muted-foreground/50" />
                        )}
                        {isSelected && <CheckIcon className="size-3.5 text-primary" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </div>
            );
          })}
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
