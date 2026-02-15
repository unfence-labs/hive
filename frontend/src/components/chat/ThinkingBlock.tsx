import { memo, useState, useEffect, useRef } from "react";
import { BrainIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { ContentPanel, ContentPanelBody } from "@/components/chat/ContentPanel";

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
  const [duration, setDuration] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (streaming) {
      startTimeRef.current = Date.now();
      setOpen(true);
      intervalRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        }
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (startTimeRef.current) {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
        startTimeRef.current = null;
      }
      const closeTimer = setTimeout(() => setOpen(false), 300);
      return () => clearTimeout(closeTimer);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [streaming]);

  if (!content) return null;

  const label = streaming
    ? "Thinking..."
    : duration > 0
      ? `Thought for ${duration}s`
      : "Thinking";

  const preview = content.split("\n")[0].slice(0, 60);

  return (
    <div className="my-0.5">
      <button
        type="button"
        className={cn(
          "inline-flex w-fit max-w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground",
          streaming && "animate-shimmer",
        )}
        onClick={() => setOpen(!open)}
      >
        <BrainIcon className="size-3.5 shrink-0" />
        <span className="shrink-0">{label}</span>
        {!open && preview && (
          <code className="truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {preview}{content.length > 60 ? "..." : ""}
          </code>
        )}
      </button>
      {open && (
        <ContentPanel>
          <ContentPanelBody className="text-muted-foreground">
            <MessageResponse isAnimating={streaming}>{content}</MessageResponse>
          </ContentPanelBody>
        </ContentPanel>
      )}
    </div>
  );
});
