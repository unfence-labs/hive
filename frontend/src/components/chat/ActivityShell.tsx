import { useState, type ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContentPanel, ContentPanelBody } from "@/components/chat/ContentPanel";
import { ToolExpandedContent } from "@/components/ChatToolUse";

interface ActivityShellProps {
  title: string;
  detail?: ReactNode;
  trailingIcon?: ReactNode;
  expandedContent?: ReactNode;
  belowContent?: ReactNode;
  defaultOpen?: boolean;
  executing?: boolean;
  /**
   * Optional element rendered before the toggle button (e.g. an image
   * thumbnail). Kept a sibling of the button — never nested inside it — so it
   * can host its own interactive controls without invalid nested buttons.
   */
  leading?: ReactNode;
}

/**
 * Collapsible activity row: a toggle button (chevron + title + detail + trailing
 * icon) with an optional expanded panel, plus an optional non-interactive
 * `leading` slot. Shared by image and diagnostic activities.
 */
export function ActivityShell({
  title,
  detail,
  trailingIcon,
  expandedContent,
  belowContent,
  defaultOpen = false,
  executing,
  leading,
}: ActivityShellProps) {
  const [open, setOpen] = useState(defaultOpen);
  const canOpen = Boolean(expandedContent);

  return (
    <div className="my-0.5">
      <div className="flex items-center gap-2">
        {leading && <span className="shrink-0">{leading}</span>}
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-md py-1 pr-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground",
            executing && "animate-shimmer",
          )}
          onClick={() => canOpen && setOpen(!open)}
          aria-expanded={canOpen ? open : undefined}
        >
          {canOpen && (
            <ChevronRightIcon className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
          )}
          <span>{title}</span>
          {detail}
          {trailingIcon && <span className="shrink-0">{trailingIcon}</span>}
          {executing && <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" />}
        </button>
      </div>
      {open && expandedContent && (
        <ContentPanel>
          <ContentPanelBody>
            <ToolExpandedContent content={expandedContent} />
          </ContentPanelBody>
        </ContentPanel>
      )}
      {belowContent}
    </div>
  );
}

export function ActivityDetailChip({ text }: { text: string }) {
  return (
    <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {text}
    </code>
  );
}
