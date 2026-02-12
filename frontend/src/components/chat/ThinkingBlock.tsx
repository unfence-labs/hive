import { memo, useState, useEffect, useRef } from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";

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

  return (
    <div className="mb-2">
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
          streaming && "animate-shimmer",
        )}
        onClick={() => setOpen(!open)}
      >
        <BrainIcon className="size-3.5" />
        <span>{label}</span>
        <ChevronDownIcon
          className={cn(
            "ml-auto size-3.5 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-1 rounded bg-muted/80 px-2 py-1 text-xs text-muted-foreground">
          <MessageResponse isAnimating={streaming}>{content}</MessageResponse>
        </div>
      )}
    </div>
  );
});
