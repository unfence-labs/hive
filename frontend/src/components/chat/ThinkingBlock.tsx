import { memo, useId, useState } from "react";
import { BrainIcon, ChevronDownIcon, EyeOffIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { ContentPanel } from "@/components/chat/ContentPanel";
import type { ReasoningSegment } from "@/types";

interface ThinkingBlockProps {
  segments?: ReasoningSegment[];
  legacyContent?: string;
  streaming?: boolean;
}

const LEGACY_SEGMENT_ID = "legacy-reasoning";

export const ThinkingBlock = memo(function ThinkingBlock({
  segments = [],
  legacyContent,
  streaming = false,
}: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const displaySegments: ReasoningSegment[] = segments.length > 0
    ? segments
    : legacyContent
      ? [{ id: LEGACY_SEGMENT_ID, kind: "thinking", content: legacyContent }]
      : [];

  if (displaySegments.length === 0) return null;

  const hiddenCount = displaySegments.filter((segment) => segment.kind === "redacted").length;
  const phaseLabel = `${displaySegments.length} ${displaySegments.length === 1 ? "phase" : "phases"}`;

  return (
    <div className="my-0.5">
      <button
        type="button"
        className="inline-flex min-h-8 max-w-full cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-field hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <BrainIcon className="size-3.5 shrink-0" />
        <span className="shrink-0">Reasoning</span>
        <span aria-hidden="true">·</span>
        {streaming ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" aria-hidden="true" />
            <span className="truncate">Working…</span>
          </span>
        ) : (
          <span className="truncate">
            {phaseLabel}{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
          </span>
        )}
        <ChevronDownIcon
          className={cn(
            "size-3.5 shrink-0 motion-safe:transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ContentPanel id={panelId} className="divide-y divide-border/60" aria-live="off">
          {displaySegments.map((segment) => (
            <div key={segment.id} className="px-3 py-2.5 text-muted-foreground">
              {segment.kind === "redacted" ? (
                <div className="flex items-center gap-2 text-xs">
                  <EyeOffIcon className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Reasoning hidden by provider</span>
                </div>
              ) : segment.content?.trim() ? (
                <MessageResponse isAnimating={streaming}>{segment.content ?? ""}</MessageResponse>
              ) : (
                <span className="text-xs">Reasoning content unavailable</span>
              )}
            </div>
          ))}
        </ContentPanel>
      )}
    </div>
  );
});
