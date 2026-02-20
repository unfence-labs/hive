import { useState, useRef, useEffect, useMemo, useCallback, type MutableRefObject, type KeyboardEvent, type ChangeEvent } from "react";
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
import type { CompletionItem, ImageAttachment, MessageOptions } from "@/types";
import { cn } from "@/lib/utils";
import { BrainIcon, BookOpenIcon, PlusIcon, SparklesIcon } from "lucide-react";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { AutocompletePopup } from "@/components/chat/AutocompletePopup";
import { useCompletions } from "@/hooks/useCompletions";
import { useChatInputDraftPersistence } from "@/hooks/useChatInputDraftPersistence";

interface ChatInputProps {
  wsId?: string;
  sessionId?: string;
  onSend: (content: string, images?: ImageAttachment[], options?: MessageOptions) => boolean;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
  placeholder?: string;
}

interface AutocompleteState {
  trigger: "/" | "@";
  query: string;
  triggerIndex: number;
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
  wsId,
  sessionId,
  onSend,
  onStop,
  disabled,
  isStreaming,
  connectionStatus,
  placeholder: customPlaceholder,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [planMode, setPlanMode] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const attachmentsRef = useRef<AttachmentsContext | null>(null);
  const isDisconnected = connectionStatus === "disconnected";
  const isInputDisabled = disabled || isStreaming || isDisconnected;
  const canSubmit = !isInputDisabled && (value.trim().length > 0 || fileCount > 0);

  useChatInputDraftPersistence({
    wsId,
    sessionId,
    value,
    thinkingEnabled,
    planMode,
    attachmentsRef,
    setValue,
    setThinkingEnabled,
    setPlanMode,
    setFileCount,
  });

  const completionItems = useCompletions(wsId);

  const filteredItems = useMemo(() => {
    if (!autocomplete) return [];
    const type = autocomplete.trigger === "/" ? "slash_command" : "agent";
    return completionItems
      .filter((item) => item.type === type)
      .filter(
        (item) =>
          autocomplete.query === "" ||
          item.name.toLowerCase().startsWith(autocomplete.query.toLowerCase()),
      );
  }, [autocomplete, completionItems]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setValue(text);

      const cursor = e.target.selectionStart ?? text.length;
      const beforeCursor = text.slice(0, cursor);
      const match = beforeCursor.match(/(^|[\s])([/@])(\S*)$/);

      if (match) {
        const trigger = match[2] as "/" | "@";
        const query = match[3];
        const triggerIndex = beforeCursor.length - match[2].length - match[3].length;
        setAutocomplete({ trigger, query, triggerIndex });
        setSelectedIndex(0);
      } else {
        setAutocomplete(null);
      }
    },
    [],
  );

  const selectItem = useCallback(
    (item: CompletionItem) => {
      if (!autocomplete) return;
      const before = value.slice(0, autocomplete.triggerIndex);
      const after = value.slice(
        autocomplete.triggerIndex + 1 + autocomplete.query.length,
      );
      const insertion = item.label + " ";
      setValue(before + insertion + after);
      setAutocomplete(null);
    },
    [autocomplete, value],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!autocomplete || filteredItems.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredItems.length) % filteredItems.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectItem(filteredItems[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setAutocomplete(null);
      }
    },
    [autocomplete, filteredItems, selectedIndex, selectItem],
  );

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
    setAutocomplete(null);
  };

  const showPopup = autocomplete !== null && filteredItems.length > 0;

  return (
    <div className="relative z-50 bg-background p-4">
      <div className={cn(
        "relative rounded-lg border border-transparent [&_[data-slot=input-group]]:!border-border/30 [&_[data-slot=input-group]]:!bg-[#1e1e28]",
        showPopup && "[&_[data-slot=input-group]]:rounded-t-none [&_[data-slot=input-group]]:!border-t-transparent",
        planMode && "[&_[data-slot=input-group]]:!border-transparent border-dashed border-primary",
        planMode && showPopup && "rounded-t-none border-t-0",
      )}>
        {showPopup && (
          <AutocompletePopup
            items={filteredItems}
            selectedIndex={selectedIndex}
            onSelect={selectItem}
            onHover={setSelectedIndex}
            planMode={planMode}
          />
        )}
        <PromptInput onSubmit={handleSubmit} accept="image/*" multiple>
        <PromptInputBody>
          <ChatInputAttachments onFileCountChange={setFileCount} attachmentsRef={attachmentsRef} />
          <PromptInputTextarea
            className="min-h-[100px] max-h-40 text-sm placeholder:text-muted-foreground/40"
            placeholder={isDisconnected ? "Reconnecting..." : (customPlaceholder ?? "Send a message...")}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
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
    </div>
  );
}
