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
import type { ModelCatalogEntry } from "@/types";
import { cn } from "@/lib/utils";

/** Provider icon: Anthropic asterisk for Claude, OpenAI swirl for Codex, Gemini star for Gemini. */
function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  if (provider === "codex") {
    return (
      <svg className={cn("size-3.5", className)} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
      </svg>
    );
  }
  if (provider === "gemini") {
    return (
      <svg className={cn("size-3.5", className)} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z" />
      </svg>
    );
  }
  // Claude: Anthropic asterisk
  return (
    <svg className={cn("size-3.5", className)} viewBox="0 0 256 256" fill="currentColor">
      <path d="M177.888 112.776 128.555 4H100.453l72.238 196.714h28.096L177.888 112.776ZM83.209 200.714 155.447 4h-28.102L55.107 200.714h28.102Z" />
    </svg>
  );
}

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
        className="w-56 border-border/30 p-0 dark:bg-[var(--menu-bg)]"
        style={{
          "--menu-bg": "color-mix(in srgb, var(--background), white 3%)",
          "--header-bg": "color-mix(in srgb, var(--background), white 6%)",
        } as React.CSSProperties}
      >
        <TooltipProvider>
          {grouped.map((group) => {
            const isGroupLocked = !!lockedProvider && group.provider !== lockedProvider;
            return (
              <div key={group.provider}>
                <div className={cn(
                  "flex items-center gap-1.5 bg-black/5 px-3 py-1.5 dark:bg-[var(--header-bg)]",
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
                            : "focus:bg-white/[0.04]",
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
