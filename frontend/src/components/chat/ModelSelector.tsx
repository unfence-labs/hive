import { useMemo } from "react";
import { CheckIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import { ProviderIcon } from "@/components/chat/ProviderIcon";
import type { ModelCatalogEntry } from "@/types";
import { cn } from "@/lib/utils";

interface ModelSelectorProps {
  models: ModelCatalogEntry[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  lockedProvider?: string;
}

export function ModelSelector({ models, selectedModelId, onSelect, lockedProvider }: ModelSelectorProps) {
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
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-56 border-border/30 p-0"
      >
        <TooltipProvider>
          {grouped.map((group) => {
            const isGroupLocked = !!lockedProvider && group.provider !== lockedProvider;
            return (
              <div key={group.provider}>
                <div className={cn(
                  "flex items-center gap-1.5 bg-muted/70 px-3 py-1.5",
                  isGroupLocked && "opacity-40",
                )}>
                  <ProviderIcon provider={group.provider} className="size-2.5 text-muted-foreground" />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {group.providerLabel}
                  </span>
                </div>
                <DropdownMenuGroup className="p-1">
                  {group.models.map((model) => {
                    const isSelected = model.id === selectedModelId;
                    const isLocked = !!lockedProvider && model.provider !== lockedProvider;

                    if (isLocked) {
                      return (
                        <Tooltip key={model.id}>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-30 cursor-not-allowed select-none">
                              <span className="flex-1">{model.label}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipPrimitive.Portal>
                            <TooltipPrimitive.Content
                              side="right"
                              sideOffset={4}
                              className="animate-in fade-in-0 zoom-in-95 z-50 rounded-md border border-border/30 bg-muted px-3 py-1.5 text-xs text-muted-foreground shadow-md"
                            >
                              Cannot switch provider mid-session
                            </TooltipPrimitive.Content>
                          </TooltipPrimitive.Portal>
                        </Tooltip>
                      );
                    }

                    return (
                      <DropdownMenuItem
                        key={model.id}
                        onClick={() => onSelect(model.id)}
                        className={cn(
                          "gap-2 rounded-sm",
                          isSelected
                            ? "bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary"
                            : "focus:bg-accent focus:text-accent-foreground",
                        )}
                      >
                        <span className="flex-1">{model.label}</span>
                        {model.isNew && (
                          <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            NEW
                          </span>
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
