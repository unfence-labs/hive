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
import { PlusIcon, SparklesIcon } from "lucide-react";

interface ChatInputProps {
  onSend: (content: string) => boolean;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
}

const MODEL_LABEL = "Opus 4.6";

export default function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
  connectionStatus,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const isDisconnected = connectionStatus === "disconnected";
  const isInputDisabled = disabled || isStreaming || isDisconnected;
  const canSubmit = !isInputDisabled && value.trim().length > 0;

  const handleSubmit = ({ text }: PromptInputMessage) => {
    const trimmed = text.trim();
    if (!trimmed || disabled || isDisconnected) {
      return;
    }
    const sent = onSend(trimmed);
    if (!sent) {
      // Throwing lets PromptInput keep user text for retry.
      throw new Error("Message send failed");
    }
    setValue("");
  };

  return (
    <div className="bg-background p-4">
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
