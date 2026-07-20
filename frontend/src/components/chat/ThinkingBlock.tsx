import { memo, useId, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentPanel, ContentPanelBody } from "@/components/chat/ContentPanel";
import type { ReasoningSegment } from "@/types";

interface ThinkingBlockProps {
  segments?: ReasoningSegment[];
  streaming?: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  segments = [],
  streaming = false,
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // The backend already parses reasoning into structured thoughts; a thought
  // with neither headline nor body has nothing to show.
  const thoughts = segments.filter((thought) => thought.headline || thought.body);

  if (thoughts.length === 0) return null;

  return (
    <div className="my-0.5">
      <button
        type="button"
        className="inline-flex max-w-full cursor-pointer items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-field hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRightIcon
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden="true"
        />
        <span className="shrink-0">{streaming ? "Reasoning…" : "Reasoning"}</span>
      </button>
      {open && (
        <ContentPanel id={panelId} aria-live="off">
          <ContentPanelBody className="font-mono text-[11px] leading-normal">
            {thoughts.map((thought) => (
              <div key={thought.id} className="flex gap-2 py-0.5">
                <span aria-hidden="true" className="shrink-0 select-none text-muted-foreground/70">
                  ·
                </span>
                <span className="min-w-0">
                  {thought.headline && <span className="text-foreground">{thought.headline}</span>}
                  {thought.headline && thought.body && <span className="text-muted-foreground"> — </span>}
                  {thought.body && <span className="text-muted-foreground">{thought.body}</span>}
                </span>
              </div>
            ))}
          </ContentPanelBody>
        </ContentPanel>
      )}
    </div>
  );
});
