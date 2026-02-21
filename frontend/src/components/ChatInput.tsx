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
import type { CompletionItem, ImageAttachment, MessageOptions, ThinkingLevel } from "@/types";
import { cn } from "@/lib/utils";
import { BrainIcon, BookOpenIcon, PlusIcon } from "lucide-react";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { AutocompletePopup } from "@/components/chat/AutocompletePopup";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { useCompletions } from "@/hooks/useCompletions";
import { useModels } from "@/hooks/useModels";
import { useChatInputDraftPersistence } from "@/hooks/useChatInputDraftPersistence";

interface ChatInputProps {
  wsId?: string;
  sessionId?: string;
  lockedProvider?: string;
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

const THINKING_LEVELS: ThinkingLevel[] = ["low", "medium", "high", "xhigh"];
const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "xHigh",
};

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
  lockedProvider,
  onSend,
  onStop,
  disabled,
  isStreaming,
  connectionStatus,
  placeholder: customPlaceholder,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>("high");
  const [planMode, setPlanMode] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const attachmentsRef = useRef<AttachmentsContext | null>(null);
  const isDisconnected = connectionStatus === "disconnected";
  const isInputDisabled = disabled || isStreaming || isDisconnected;
  const canSubmit = !isInputDisabled && (value.trim().length > 0 || fileCount > 0);

  const { models, defaultModelId, selectedModelId, setSelectedModelId, capabilities } = useModels(lockedProvider);

  const supportsThinkingToggle = capabilities?.thinking === true;
  const supportsThinkingLevels = capabilities?.thinking === "levels";
  const supportsPlanMode = capabilities?.planMode ?? true;
  const supportsCompletions = capabilities?.completions ?? true;

  useChatInputDraftPersistence({
    wsId,
    sessionId,
    value,
    thinkingEnabled,
    planMode,
    selectedModelId,
    defaultModelId,
    thinkingLevel,
    attachmentsRef,
    setValue,
    setThinkingEnabled,
    setPlanMode,
    setSelectedModelId,
    setThinkingLevel,
    setFileCount,
  });

  // Auto-correct model if it conflicts with the session's locked provider
  useEffect(() => {
    if (!lockedProvider || !selectedModelId) return;
    const currentProvider = selectedModelId.split(":")[0];
    if (currentProvider !== lockedProvider) {
      const fallback = models.find((m) => m.provider === lockedProvider && m.isDefault)
        ?? models.find((m) => m.provider === lockedProvider);
      if (fallback) setSelectedModelId(fallback.id);
    }
  }, [lockedProvider, selectedModelId, models, setSelectedModelId]);

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

      if (match && supportsCompletions) {
        const trigger = match[2] as "/" | "@";
        const query = match[3];
        const triggerIndex = beforeCursor.length - match[2].length - match[3].length;
        setAutocomplete({ trigger, query, triggerIndex });
        setSelectedIndex(0);
      } else {
        setAutocomplete(null);
      }
    },
    [supportsCompletions],
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

  const cycleThinkingLevel = useCallback(() => {
    setThinkingLevel((current) => {
      const idx = THINKING_LEVELS.indexOf(current);
      return THINKING_LEVELS[(idx + 1) % THINKING_LEVELS.length];
    });
  }, []);

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

    const options: MessageOptions = {
      model: selectedModelId || undefined,
      ...(supportsPlanMode && { planMode }),
      ...(supportsThinkingToggle && { thinkingEnabled }),
      ...(supportsThinkingLevels && { thinkingLevel }),
    };

    const sent = onSend(trimmed, images, options);
    if (!sent) throw new Error("Message send failed");
    setValue("");
    setAutocomplete(null);
  };

  const showPopup = autocomplete !== null && filteredItems.length > 0;

  const activeStyle = "bg-primary/10 text-primary ring-1 ring-primary/15 hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15";

  return (
    <div className="relative z-50 bg-background p-4">
      <div className={cn(
        "relative rounded-lg border border-transparent [&_[data-slot=input-group]]:!border-border/30 [&_[data-slot=input-group]]:!bg-[#1e1e28]",
        showPopup && "[&_[data-slot=input-group]]:rounded-t-none [&_[data-slot=input-group]]:!border-t-transparent",
        planMode && supportsPlanMode && "[&_[data-slot=input-group]]:!border-transparent border-dashed border-primary",
        planMode && supportsPlanMode && showPopup && "rounded-t-none border-t-0",
      )}>
        {showPopup && (
          <AutocompletePopup
            items={filteredItems}
            selectedIndex={selectedIndex}
            onSelect={selectItem}
            onHover={setSelectedIndex}
            planMode={planMode && supportsPlanMode}
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
            <ModelSelector
              models={models}
              selectedModelId={selectedModelId}
              defaultModelId={defaultModelId}
              onSelect={setSelectedModelId}
              lockedProvider={lockedProvider}
            />
            {supportsThinkingToggle && (
              <PromptInputButton
                aria-label="Toggle thinking"
                variant="ghost"
                size="xs"
                onClick={() => setThinkingEnabled((v) => !v)}
                className={cn("h-5 text-[11px] transition-colors", thinkingEnabled && activeStyle)}
              >
                <BrainIcon className="size-3" />
                Thinking
              </PromptInputButton>
            )}
            {supportsThinkingLevels && (
              <PromptInputButton
                aria-label={`Thinking: ${THINKING_LEVEL_LABELS[thinkingLevel]}`}
                variant="ghost"
                size="xs"
                onClick={cycleThinkingLevel}
                className={cn("h-5 text-[11px] transition-colors", activeStyle)}
              >
                <BrainIcon className="size-3" />
                {THINKING_LEVEL_LABELS[thinkingLevel]}
              </PromptInputButton>
            )}
            {supportsPlanMode && (
              <PromptInputButton
                aria-label="Toggle plan mode"
                variant="ghost"
                size="xs"
                onClick={() => setPlanMode((v) => !v)}
                className={cn("h-5 text-[11px] transition-colors", planMode && activeStyle)}
              >
                <BookOpenIcon className="size-3" />
                Plan
              </PromptInputButton>
            )}
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
