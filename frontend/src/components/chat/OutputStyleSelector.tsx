import { CheckIcon, MessageCircleIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptInputButton } from "@/components/ai-elements/prompt-input";
import type { OutputStyle } from "@/types";

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

interface OutputStyleSelectorProps {
  styles: OutputStyle[];
  selectedStyle: OutputStyle;
  onSelect: (style: OutputStyle) => void;
  disabled?: boolean;
}

export function OutputStyleSelector({
  styles,
  selectedStyle,
  onSelect,
  disabled = false,
}: OutputStyleSelectorProps) {
  const label = OUTPUT_STYLE_LABELS[selectedStyle] ?? selectedStyle;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton
          aria-label={`Output style: ${label}`}
          variant="ghost"
          size="xs"
          disabled={disabled}
          className="h-5 gap-1 text-[11px]"
        >
          <MessageCircleIcon className="size-3" />
          {label}
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-40 border-border/30 p-0">
        <div className="flex items-center gap-1.5 bg-muted/70 px-3 py-1.5">
          <MessageCircleIcon className="size-2.5 text-muted-foreground" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Output style
          </span>
        </div>
        <DropdownMenuGroup className="p-1">
          {styles.map((style) => {
            const isSelected = style === selectedStyle;
            return (
              <DropdownMenuItem key={style} onClick={() => onSelect(style)}>
                <span className="flex-1">{OUTPUT_STYLE_LABELS[style] ?? style}</span>
                {isSelected && <CheckIcon className="size-3.5 text-primary" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
