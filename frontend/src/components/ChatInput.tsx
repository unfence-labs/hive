import { useState } from "react";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import type { MessageOptions } from "@/types";
import { cn } from "@/lib/utils";
import { BrainIcon, BookOpenIcon, PlusIcon, SparklesIcon } from "lucide-react";

interface ChatInputProps {
  onSend: (content: string, options?: MessageOptions) => boolean;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  isAwaitingResponse?: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
}

const MODEL_LABEL = "Opus 4.6";

export default function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
  isAwaitingResponse = false,
  connectionStatus,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [planMode, setPlanMode] = useState(false);
  const isDisconnected = connectionStatus === "disconnected";
  const isInputDisabled = disabled || isStreaming || isDisconnected;
  const canSubmit = !isInputDisabled && value.trim().length > 0;

  const handleSubmit = ({ text }: PromptInputMessage) => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isDisconnected) {
      return;
    }
    const sent = onSend(trimmed, { planMode, thinkingEnabled });
    if (!sent) {
      throw new Error("Message send failed");
    }
    setValue("");
  };

  return (
    <div className="border-t border-border/30 bg-background p-4">
      {(isStreaming || isAwaitingResponse) ? (
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <AgentActivityPreview size="small" />
          <span>{isAwaitingResponse ? "Awaiting response\u2026" : "Working\u2026"}</span>
        </div>
      ) : null}
      <PromptInput onSubmit={handleSubmit}>
        <PromptInputBody>
          <PromptInputTextarea
            className="min-h-[44px] max-h-40"
            placeholder={isDisconnected ? "Reconnecting..." : "Send a message..."}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={isInputDisabled}
            rows={1}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputButton aria-label="Add attachments" variant="ghost">
              <PlusIcon className="size-4" />
            </PromptInputButton>
            <PromptInputButton aria-label={`Model ${MODEL_LABEL}`} variant="ghost">
              <SparklesIcon className="size-4" />
              {MODEL_LABEL}
            </PromptInputButton>
            <PromptInputButton
              aria-label="Toggle thinking"
              variant="ghost"
              onClick={() => setThinkingEnabled((v) => !v)}
              className={cn(
                "transition-colors",
                thinkingEnabled && "bg-accent text-accent-foreground",
              )}
            >
              <BrainIcon className="size-4" />
              Thinking
            </PromptInputButton>
            <PromptInputButton
              aria-label="Toggle plan mode"
              variant="ghost"
              onClick={() => setPlanMode((v) => !v)}
              className={cn(
                "transition-colors",
                planMode && "bg-accent text-accent-foreground",
              )}
            >
              <BookOpenIcon className="size-4" />
              Plan
            </PromptInputButton>
          </PromptInputTools>
          <PromptInputSubmit
            aria-label={isStreaming ? "Stop" : "Send"}
            status={isStreaming ? "streaming" : "ready"}
            onStop={onStop}
            disabled={!isStreaming && !canSubmit}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
