import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSend: (content: string) => boolean;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
}

export default function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
  connectionStatus,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isStreaming && !disabled) {
      textareaRef.current?.focus();
    }
  }, [isStreaming, disabled]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    if (onSend(trimmed)) {
      setValue("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const isDisconnected = connectionStatus === "disconnected";

  return (
    <div className="border-t bg-background p-4">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          placeholder={isDisconnected ? "Reconnecting..." : "Send a message..."}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isStreaming || isDisconnected}
          className="min-h-[44px] max-h-40 flex-1 resize-none"
          rows={1}
        />
        {isStreaming ? (
          <Button variant="destructive" size="sm" className="self-end" onClick={onStop}>
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            className="self-end"
            disabled={disabled || !value.trim() || isDisconnected}
            onClick={handleSend}
          >
            Send
          </Button>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            connectionStatus === "connected"
              ? "bg-green-500"
              : connectionStatus === "connecting"
                ? "bg-yellow-500"
                : "bg-red-500"
          }`}
        />
        {connectionStatus === "connected"
          ? "Enter to send, Shift+Enter for new line"
          : connectionStatus === "connecting"
            ? "Connecting..."
            : "Disconnected — reconnecting..."}
      </div>
    </div>
  );
}
