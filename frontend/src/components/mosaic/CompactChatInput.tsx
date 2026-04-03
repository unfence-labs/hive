import { useState, useCallback, type KeyboardEvent } from "react";
import { BookOpenIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QueuedMessage, MessageOptions } from "@/types";

interface CompactChatInputProps {
  onSend: (content: string, options?: MessageOptions) => boolean;
  onStop: () => void;
  isStreaming: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
  placeholder?: string;
  queuedMessage?: QueuedMessage | null;
  onQueue: (msg: QueuedMessage) => void;
}

export function CompactChatInput({
  onSend,
  onStop,
  isStreaming,
  connectionStatus,
  placeholder,
  queuedMessage,
  onQueue,
}: CompactChatInputProps) {
  const [value, setValue] = useState("");
  const [planMode, setPlanMode] = useState(false);

  const isDisconnected = connectionStatus === "disconnected";
  const hasQueued = !!queuedMessage;
  const canType = !isDisconnected && !hasQueued;
  const canSubmit = canType && value.trim().length > 0;

  const buildOptions = useCallback((): MessageOptions | undefined => {
    if (planMode) return { planMode: true };
    return undefined;
  }, [planMode]);

  const submit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;

    const options = buildOptions();

    if (isStreaming) {
      onQueue({ content: trimmed, options });
      setValue("");
      return;
    }

    const sent = onSend(trimmed, options);
    if (sent) setValue("");
  }, [value, isStreaming, onSend, onQueue, buildOptions]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="flex items-end gap-1.5 border-t border-border bg-background px-2 py-1.5">
      <button
        type="button"
        onClick={() => setPlanMode((v) => !v)}
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          planMode
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground/40 hover:bg-muted hover:text-muted-foreground",
        )}
        aria-label="Toggle plan mode"
        title={planMode ? "Plan mode on" : "Plan mode off"}
      >
        <BookOpenIcon className="h-3.5 w-3.5" />
      </button>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!canType}
        placeholder={isDisconnected ? "Disconnected" : placeholder ?? "Send a message…"}
        rows={1}
        className={cn(
          "min-h-[28px] max-h-[72px] flex-1 resize-none rounded-md border border-border bg-input/30 px-2.5 py-1.5 text-sm leading-snug",
          "placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          planMode && "border-primary/40 border-dashed",
        )}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 72)}px`;
        }}
      />
      {isStreaming ? (
        <button
          type="button"
          onClick={onStop}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Stop"
          title="Stop"
        >
          <SquareIcon className="h-3.5 w-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
            canSubmit
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "text-muted-foreground/40 cursor-not-allowed",
          )}
          aria-label="Send"
          title="Send"
        >
          <SendHorizontalIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
