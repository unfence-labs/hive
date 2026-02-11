import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
}

export default function ChatInput({ onSend, onStop, disabled, isStreaming }: ChatInputProps) {
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
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter sends (unless Shift is held for multiline)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Ctrl/Cmd+Enter also sends
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t bg-background p-4">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          placeholder="Send a message..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled || isStreaming}
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
            disabled={disabled || !value.trim()}
            onClick={handleSend}
          >
            Send
          </Button>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Enter to send, Shift+Enter for new line
      </div>
    </div>
  );
}
