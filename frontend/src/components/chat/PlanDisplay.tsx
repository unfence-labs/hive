import { useState, memo } from "react";
import { FileTextIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";

interface PlanDisplayProps {
  content: string;
  defaultOpen?: boolean;
}

export const PlanDisplay = memo(function PlanDisplay({
  content,
  defaultOpen = true,
}: PlanDisplayProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (!content) return null;

  return (
    <div className="my-2 rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium hover:bg-muted/50"
        onClick={() => setOpen(!open)}
      >
        <FileTextIcon className="size-4 text-muted-foreground" />
        <span>Implementation Plan</span>
        <ChevronDownIcon
          className={cn(
            "ml-auto size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t px-4 py-3 text-sm">
          <MessageResponse>{content}</MessageResponse>
        </div>
      )}
    </div>
  );
});
