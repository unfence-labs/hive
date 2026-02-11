import { memo, useState } from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "@/components/MarkdownRenderer";

interface ThinkingBlockProps {
  content: string;
  defaultOpen?: boolean;
  streaming?: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  content,
  defaultOpen = false,
  streaming = false,
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!content) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <BrainIcon className="size-3.5" />
        <span>{streaming ? "Thinking..." : "Thinking"}</span>
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-1 rounded bg-muted/80 px-2 py-1 text-xs text-muted-foreground">
          <MarkdownRenderer content={content} />
        </div>
      )}
    </div>
  );
});
