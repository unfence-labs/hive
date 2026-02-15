import { useState, useRef, useEffect, type MutableRefObject } from "react";
import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type AttachmentsContext,
} from "@/components/ai-elements/prompt-input";
import type { ImageAttachment, MessageOptions } from "@/types";
import { cn } from "@/lib/utils";
import { BrainIcon, BookOpenIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";

interface ChatInputProps {
  onSend: (content: string, images?: ImageAttachment[], options?: MessageOptions) => boolean;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
}

const MODEL_LABEL = "Opus 4.6";

/** Bridge component: syncs PromptInput's internal attachment state to the parent. */
function ChatInputAttachments({
  onFileCountChange,
  attachmentsRef,
}: {
  onFileCountChange: (count: number) => void;
  attachmentsRef: MutableRefObject<AttachmentsContext | null>;
}) {
  const attachments = usePromptInputAttachments();
  attachmentsRef.current = attachments;

  useEffect(() => {
    onFileCountChange(attachments.files.length);
  }, [attachments.files.length, onFileCountChange]);

  if (attachments.files.length === 0) return null;
  return <AttachmentPreview files={attachments.files} onRemove={attachments.remove} />;
}

export default function ChatInput({
  onSend,
  onStop,
  disabled,
  isStreaming,
  connectionStatus,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [planMode, setPlanMode] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const attachmentsRef = useRef<AttachmentsContext | null>(null);
  const isDisconnected = connectionStatus === "disconnected";
  const isInputDisabled = disabled || isStreaming || isDisconnected;
  const canSubmit = !isInputDisabled && (value.trim().length > 0 || fileCount > 0);

  const handleSubmit = ({ text, files }: PromptInputMessage) => {
    const trimmed = text.trim();
    if (!trimmed && files.length === 0) return;
    if (disabled || isDisconnected) return;

    const images: ImageAttachment[] | undefined = files.length > 0
      ? files.map((f) => ({
          name: f.filename ?? "image",
          mediaType: f.mediaType ?? "image/png",
          dataUrl: f.url,
        }))
      : undefined;

    const sent = onSend(trimmed, images, { planMode, thinkingEnabled });
    if (!sent) throw new Error("Message send failed");
    setValue("");
  };

  return (
    <div className="border-t border-border/30 bg-background p-4">
      <PromptInput onSubmit={handleSubmit} accept="image/*" multiple>
        <PromptInputBody>
          <ChatInputAttachments onFileCountChange={setFileCount} attachmentsRef={attachmentsRef} />
          <PromptInputTextarea
            className="min-h-[100px] max-h-40 text-sm placeholder:text-muted-foreground/40"
            placeholder={isDisconnected ? "Reconnecting..." : "Send a message..."}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={isInputDisabled}
            rows={1}
          />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools className="gap-2">
            <PromptInputButton aria-label={`Model ${MODEL_LABEL}`} variant="ghost" size="xs" className="h-5 text-[11px]">
              <SparklesIcon className="size-3" />
              {MODEL_LABEL}
            </PromptInputButton>
            <PromptInputButton
              aria-label="Toggle thinking"
              variant="ghost"
              size="xs"
              onClick={() => setThinkingEnabled((v) => !v)}
              className={cn(
                "h-5 text-[11px] transition-colors",
                thinkingEnabled && "bg-primary/10 text-primary ring-1 ring-primary/15 hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15",
              )}
            >
              <BrainIcon className="size-3" />
              Thinking
            </PromptInputButton>
            <PromptInputButton
              aria-label="Toggle plan mode"
              variant="ghost"
              size="xs"
              onClick={() => setPlanMode((v) => !v)}
              className={cn(
                "h-5 text-[11px] transition-colors",
                planMode && "bg-primary/10 text-primary ring-1 ring-primary/15 hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15",
              )}
            >
              <BookOpenIcon className="size-3" />
              Plan
            </PromptInputButton>
          </PromptInputTools>
          <PromptInputTools className="gap-2">
            <PromptInputButton
              aria-label="Add attachments"
              variant="ghost"
              size="icon-xs"
              className="size-5"
              onClick={() => attachmentsRef.current?.openFileDialog()}
            >
              <PlusIcon className="size-3" />
            </PromptInputButton>
            <PromptInputSubmit
              aria-label={isStreaming ? "Stop" : "Send"}
              status={isStreaming ? "streaming" : "ready"}
              variant="ghost"
              onStop={onStop}
              disabled={!isStreaming && !canSubmit}
              size="icon-xs"
              className={cn(
                "size-5 border border-border/50",
                canSubmit && "bg-white text-black hover:bg-white/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
              )}
            />
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
