import { BrainIcon, CheckIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import type { ThinkingLevel } from "@/types";
import { cn } from "@/lib/utils";

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  none: "None",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "xHigh",
  max: "Max",
  ultra: "Ultra",
};

interface ThinkingSelectorProps {
  levels: ThinkingLevel[];
  selectedLevel: ThinkingLevel;
  onSelect: (level: ThinkingLevel) => void;
  className?: string;
}

export function ThinkingSelector({
  levels,
  selectedLevel,
  onSelect,
  className,
}: ThinkingSelectorProps) {
  const label = THINKING_LEVEL_LABELS[selectedLevel] ?? selectedLevel;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton
          aria-label={`Thinking: ${label}`}
          variant="ghost"
          size="xs"
          className={cn("h-5 text-[11px] gap-1 transition-colors", className)}
        >
          <BrainIcon className="size-3" />
          {label}
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-36 border-border/30 p-0"
      >
        <div className="flex items-center gap-1.5 bg-muted/70 px-3 py-1.5">
          <BrainIcon className="size-2.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Thinking
          </span>
        </div>
        <DropdownMenuGroup className="p-1">
          {/* Render highest level first so the menu reads Max → Low top-to-bottom.
              Copy before reversing to avoid mutating the caller's array. */}
          {[...levels].reverse().map((level) => {
            const isSelected = level === selectedLevel;

            return (
              <DropdownMenuItem
                key={level}
                onClick={() => onSelect(level)}
                className={cn(
                  "gap-2 rounded-sm",
                  isSelected
                    ? "bg-primary/10 text-primary focus:bg-primary/10 focus:text-primary"
                    : "focus:bg-accent focus:text-accent-foreground",
                )}
              >
                <span className="flex-1">{THINKING_LEVEL_LABELS[level] ?? level}</span>
                {isSelected && <CheckIcon className="size-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
