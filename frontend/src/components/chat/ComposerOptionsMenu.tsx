import { CheckIcon, MessageCircleIcon, SlidersHorizontalIcon, ZapIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import type { OutputStyle } from "@/types";
import { cn } from "@/lib/utils";

const OUTPUT_STYLE_LABELS: Partial<Record<OutputStyle, string>> = {
  default: "Default",
  proactive: "Proactive",
  concise: "Concise",
  explanatory: "Explanatory",
  learning: "Learning",
  friendly: "Friendly",
  pragmatic: "Pragmatic",
  none: "None",
};

interface ComposerOptionsMenuProps {
  styles: OutputStyle[];
  /** Undefined when the provider has no output styles; hides the style row. */
  selectedStyle?: OutputStyle;
  onSelectStyle: (style: OutputStyle) => void;
  /** Style is fixed after the first user message; row stays visible but inert. */
  styleLocked: boolean;
  /** Some model of the current provider supports fast mode; shows the row. */
  showFastMode: boolean;
  /** The selected model itself supports fast mode; enables the row. */
  fastModeSupported: boolean;
  fastMode: boolean;
  onToggleFastMode: () => void;
  className?: string;
}

export function ComposerOptionsMenu({
  styles,
  selectedStyle,
  onSelectStyle,
  styleLocked,
  showFastMode,
  fastModeSupported,
  fastMode,
  onToggleFastMode,
  className,
}: ComposerOptionsMenuProps) {
  const showStyleRow = selectedStyle !== undefined;
  if (!showStyleRow && !showFastMode) return null;

  const styleLabel = selectedStyle ? (OUTPUT_STYLE_LABELS[selectedStyle] ?? selectedStyle) : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton
          aria-label="More options"
          variant="ghost"
          size="icon-xs"
          className={cn("size-5 transition-colors", className)}
        >
          <SlidersHorizontalIcon className="size-3" />
        </PromptInputButton>
      </DropdownMenuTrigger>
      {/* Close instantly: the exit animation flashes the updated value while fading out. */}
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-52 border-border/30 p-0 data-[state=closed]:animate-none!"
      >
        <div className="flex items-center gap-1.5 bg-muted/70 px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Options
          </span>
        </div>
        <TooltipProvider>
          <DropdownMenuGroup className="p-1">
            {showStyleRow && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  disabled={styleLocked}
                  className="gap-2 rounded-sm data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                >
                  <MessageCircleIcon className="size-3 shrink-0 text-muted-foreground" />
                  <span className="shrink-0">Output</span>
                  <span className="min-w-0 flex-1 truncate text-right text-[11px] leading-5 text-muted-foreground">
                    {styleLabel}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40 border-border/30 p-0 data-[state=closed]:animate-none!">
                  <DropdownMenuGroup className="p-1">
                    {styles.map((style) => {
                      const isSelected = style === selectedStyle;
                      return (
                        <DropdownMenuItem
                          key={style}
                          onClick={() => onSelectStyle(style)}
                          className={cn(
                            "gap-2 rounded-sm",
                            isSelected
                              ? "bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary"
                              : "focus:bg-accent focus:text-accent-foreground",
                          )}
                        >
                          <span className="flex-1">{OUTPUT_STYLE_LABELS[style] ?? style}</span>
                          {isSelected && <CheckIcon className="size-3.5 text-primary" />}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {showFastMode &&
              (fastModeSupported ? (
                <DropdownMenuItem
                  onClick={(e) => {
                    // Keep the menu open so toggling reads as a switch, not an action.
                    e.preventDefault();
                    onToggleFastMode();
                  }}
                  className="gap-2 rounded-sm"
                >
                  <ZapIcon className="size-3 text-muted-foreground" />
                  <span className="flex-1">Fast mode</span>
                  {fastMode && <CheckIcon className="size-3.5 text-primary" />}
                </DropdownMenuItem>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex cursor-not-allowed items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-30 select-none">
                      <ZapIcon className="size-3" />
                      <span className="flex-1">Fast mode</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipPrimitive.Portal>
                    <TooltipPrimitive.Content
                      side="right"
                      sideOffset={4}
                      className="animate-in fade-in-0 zoom-in-95 z-50 rounded-md border border-border/30 bg-muted px-3 py-1.5 text-xs text-muted-foreground shadow-md"
                    >
                      Only available with Opus
                    </TooltipPrimitive.Content>
                  </TooltipPrimitive.Portal>
                </Tooltip>
              ))}
          </DropdownMenuGroup>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
