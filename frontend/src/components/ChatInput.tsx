import { useState, useRef, useEffect, useMemo, useCallback, forwardRef, useImperativeHandle, type MutableRefObject, type KeyboardEvent, type ChangeEvent } from "react";
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
import type { ChatMessage, CompletionItem, FileMention, ImageAttachment, MessageOptions, QueuedMessage, ThinkingLevel } from "@/types";
import { cn } from "@/lib/utils";
import { BrainIcon, BookOpenIcon, PlusIcon, SquareIcon } from "lucide-react";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { AutocompletePopup } from "@/components/chat/AutocompletePopup";
import { FileAutocompletePopup } from "@/components/chat/FileAutocompletePopup";
import { MentionHighlightOverlay } from "@/components/chat/MentionHighlightOverlay";
import { ContextRing } from "@/components/chat/ContextRing";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { useCompletions } from "@/hooks/useCompletions";
import { useFileCompletions } from "@/hooks/useFileCompletions";
import { useContextUsage } from "@/hooks/useContextUsage";
import { useModels } from "@/hooks/useModels";
import { useChatInputDraftPersistence } from "@/hooks/useChatInputDraftPersistence";
import { fuzzyMatchFiles, disambiguateDisplayName, type FuzzyResult } from "@/lib/fuzzy-match";

export interface ChatInputHandle {
  appendText: (text: string) => void;
}

interface ChatInputProps {
  wsId?: string;
  sessionId?: string;
  lockedProvider?: string;
  onSend: (content: string, images?: ImageAttachment[], options?: MessageOptions, fileMentions?: FileMention[]) => boolean;
  onStop: () => void;
  disabled: boolean;
  isStreaming: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
  placeholder?: string;
  messages: ChatMessage[];
  queuedMessage?: QueuedMessage | null;
  onQueue: (msg: QueuedMessage) => void;
  agentPlanMode?: boolean;
}

interface AutocompleteState {
  trigger: "/" | "@" | "#";
  query: string;
  triggerIndex: number;
}

const THINKING_LEVEL_LABELS: Record<ThinkingLevel, string> = {
  none: "None",
  minimal: "Min",
  low: "Low",
  medium: "Med",
  high: "High",
  xhigh: "xHigh",
  max: "Max",
};

const DEFAULT_THINKING_LEVEL: ThinkingLevel = "high";

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

const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput({
  wsId,
  sessionId,
  lockedProvider,
  onSend,
  onStop,
  disabled,
  isStreaming,
  connectionStatus,
  placeholder: customPlaceholder,
  messages,
  queuedMessage,
  onQueue,
  agentPlanMode,
}, ref) {
  const [value, setValue] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL);
  const [planMode, setPlanMode] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [fileMentions, setFileMentions] = useState<FileMention[]>([]);
  const attachmentsRef = useRef<AttachmentsContext | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useImperativeHandle(ref, () => ({
    appendText: (text: string) => {
      setValue((prev) => (prev ? `${prev}\n\n${text}` : text));
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
  }), []);

  const isDisconnected = connectionStatus === "disconnected";
  const hasQueuedMessage = !!queuedMessage;
  const isInputDisabled = disabled || isDisconnected || hasQueuedMessage;
  const canSubmit = !isInputDisabled && (value.trim().length > 0 || fileCount > 0);

  const { models, defaultModelId, selectedModelId, selectedModel, setSelectedModelId, capabilities } = useModels(lockedProvider);
  const contextUsage = useContextUsage(messages, selectedModel);

  const thinkingLevels = useMemo<ThinkingLevel[]>(
    () => capabilities?.thinkingLevels ?? [],
    [capabilities?.thinkingLevels],
  );
  const supportsThinking = thinkingLevels.length > 0;
  const supportsPlanMode = capabilities?.planMode ?? true;
  const supportsCompletions = capabilities?.completions ?? true;

  const effectiveThinkingLevel: ThinkingLevel = supportsThinking
    ? (thinkingLevels.includes(thinkingLevel)
        ? thinkingLevel
        : (thinkingLevels.includes(DEFAULT_THINKING_LEVEL) ? DEFAULT_THINKING_LEVEL : thinkingLevels[0]))
    : thinkingLevel;

  useChatInputDraftPersistence({
    wsId,
    sessionId,
    value,
    planMode,
    selectedModelId,
    defaultModelId,
    thinkingLevel,
    attachmentsRef,
    fileMentions,
    setValue,
    setPlanMode,
    setSelectedModelId,
    setThinkingLevel,
    setFileCount,
    setFileMentions,
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

  // Auto-enable plan mode when the agent enters plan mode on its own
  useEffect(() => {
    if (agentPlanMode === true) setPlanMode(true);
    if (agentPlanMode === false) setPlanMode(false);
  }, [agentPlanMode]);

  const completionItems = useCompletions(wsId);
  const filePaths = useFileCompletions(wsId);

  const filteredItems = useMemo(() => {
    if (!autocomplete || autocomplete.trigger === "#") return [];
    const type = autocomplete.trigger === "/" ? "slash_command" : "agent";
    return completionItems
      .filter((item) => item.type === type)
      .filter(
        (item) =>
          autocomplete.query === "" ||
          item.name.toLowerCase().startsWith(autocomplete.query.toLowerCase()),
      );
  }, [autocomplete, completionItems]);

  const fileResults = useMemo(() => {
    if (!autocomplete || autocomplete.trigger !== "#") return [];
    return fuzzyMatchFiles(filePaths, autocomplete.query);
  }, [autocomplete, filePaths]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setValue(text);

      // Prune mentions that no longer appear in the text
      setFileMentions((prev) =>
        prev.filter((m) => text.includes(`#${m.displayName}`)),
      );
      const cursor = e.target.selectionStart ?? text.length;
      const beforeCursor = text.slice(0, cursor);
      const match = beforeCursor.match(/(^|[\s])([/@#])(\S*)$/);

      if (match) {
        const trigger = match[2] as "/" | "@" | "#";
        if (trigger === "#" || supportsCompletions) {
          const query = match[3];
          const triggerIndex = beforeCursor.length - match[2].length - match[3].length;
          setAutocomplete({ trigger, query, triggerIndex });
          setSelectedIndex(0);
        } else {
          setAutocomplete(null);
        }
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

  const selectFileItem = useCallback(
    (result: FuzzyResult) => {
      if (!autocomplete) return;
      const displayName = disambiguateDisplayName(result.path, filePaths);
      const before = value.slice(0, autocomplete.triggerIndex);
      const after = value.slice(
        autocomplete.triggerIndex + 1 + autocomplete.query.length,
      );
      const insertion = `#${displayName} `;
      setValue(before + insertion + after);
      setFileMentions((prev) => [
        ...prev.filter((m) => m.relativePath !== result.path),
        { displayName, relativePath: result.path },
      ]);
      setAutocomplete(null);
    },
    [autocomplete, value, filePaths],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!autocomplete) return;

      if (autocomplete.trigger === "#") {
        if (fileResults.length === 0) return;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % fileResults.length);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => (i - 1 + fileResults.length) % fileResults.length);
        } else if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectFileItem(fileResults[selectedIndex]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          setAutocomplete(null);
        }
      } else {
        if (filteredItems.length === 0) return;
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
      }
    },
    [autocomplete, filteredItems, fileResults, selectedIndex, selectItem, selectFileItem],
  );

  const cycleThinkingLevel = useCallback(() => {
    setThinkingLevel((current) => {
      if (thinkingLevels.length === 0) return current;
      const idx = thinkingLevels.indexOf(current);
      if (idx === -1) return thinkingLevels[0];
      return thinkingLevels[(idx + 1) % thinkingLevels.length];
    });
  }, [thinkingLevels]);

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
      ...(supportsThinking && { thinkingLevel: effectiveThinkingLevel }),
    };

    const mentions: FileMention[] | undefined = fileMentions.length > 0
      ? fileMentions.map((m) => ({ displayName: m.displayName, relativePath: m.relativePath }))
      : undefined;

    if (isStreaming) {
      onQueue({ content: trimmed, images, options, fileMentions: mentions });
    } else {
      const sent = onSend(trimmed, images, options, mentions);
      if (!sent) throw new Error("Message send failed");
    }
    setValue("");
    setFileMentions([]);
    setAutocomplete(null);
  };

  const showSlashPopup = autocomplete !== null && autocomplete.trigger !== "#" && filteredItems.length > 0;
  const showFilePopup = autocomplete !== null && autocomplete.trigger === "#" && fileResults.length > 0;
  const showPopup = showSlashPopup || showFilePopup;

  const activeStyle = "bg-primary/10 text-primary ring-1 ring-primary/15 hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15";

  return (
    <div className="relative z-50 bg-background p-4">
      <div className={cn(
        "relative rounded-lg border border-transparent [&_[data-slot=input-group]]:!border-border/50 [&_[data-slot=input-group]]:!bg-card dark:[&_[data-slot=input-group]]:!border-border/30 dark:[&_[data-slot=input-group]]:!bg-[#1e1e28]",
        showPopup && "[&_[data-slot=input-group]]:rounded-t-none [&_[data-slot=input-group]]:!border-t-transparent",
        planMode && supportsPlanMode && "[&_[data-slot=input-group]]:!border-transparent border-dashed border-primary",
        planMode && supportsPlanMode && showPopup && "rounded-t-none border-t-0",
      )}>
        {showSlashPopup && (
          <AutocompletePopup
            items={filteredItems}
            selectedIndex={selectedIndex}
            onSelect={selectItem}
            onHover={setSelectedIndex}
            planMode={planMode && supportsPlanMode}
          />
        )}
        {showFilePopup && (
          <FileAutocompletePopup
            items={fileResults}
            selectedIndex={selectedIndex}
            onSelect={selectFileItem}
            onHover={setSelectedIndex}
            planMode={planMode && supportsPlanMode}
          />
        )}
        <PromptInput onSubmit={handleSubmit} accept="image/*" multiple>
        <PromptInputBody>
          <ChatInputAttachments onFileCountChange={setFileCount} attachmentsRef={attachmentsRef} />
          <MentionHighlightOverlay
            value={value}
            fileMentions={fileMentions}
            textareaRef={textareaRef}
          />
          <PromptInputTextarea
            ref={textareaRef}
            className="min-h-[100px] max-h-40 bg-transparent text-sm placeholder:text-muted-foreground/40"
            placeholder={isDisconnected ? "Reconnecting..." : (customPlaceholder ?? "Send message, #mention files, @call agents, run /commands")}
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
              onSelect={setSelectedModelId}
              lockedProvider={lockedProvider}
            />
            {supportsThinking && (
              <PromptInputButton
                aria-label={`Thinking: ${THINKING_LEVEL_LABELS[effectiveThinkingLevel]}`}
                variant="ghost"
                size="xs"
                onClick={cycleThinkingLevel}
                className={cn("h-5 text-[11px] transition-colors", activeStyle)}
              >
                <BrainIcon className="size-3" />
                {THINKING_LEVEL_LABELS[effectiveThinkingLevel]}
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
            <ContextRing usage={contextUsage} />
            <PromptInputButton
              aria-label="Add attachments"
              variant="ghost"
              size="icon-xs"
              className="size-5"
              onClick={() => attachmentsRef.current?.openFileDialog()}
            >
              <PlusIcon className="size-3" />
            </PromptInputButton>
            {isStreaming && (
              <PromptInputButton
                aria-label="Stop"
                variant="ghost"
                size="icon-xs"
                className="size-5"
                onClick={(e) => { e.preventDefault(); onStop(); }}
              >
                <SquareIcon className="size-3 text-red-500" />
              </PromptInputButton>
            )}
            <PromptInputSubmit
              aria-label="Send"
              status="ready"
              variant="ghost"
              disabled={!canSubmit}
              size="icon-xs"
              className={cn(
                "size-5 border border-border/50",
                canSubmit && "bg-white text-black hover:bg-white/90 dark:bg-white dark:text-black dark:hover:bg-white/90",
              )}
            />
          </PromptInputTools>
        </PromptInputFooter>
        </PromptInput>
        {!value.trim() && !isInputDisabled && (
          <div className="pointer-events-none absolute top-2 right-2 z-10 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const text = "Commit and push all changes";
                const options: MessageOptions = {
                  model: selectedModelId || undefined,
                  ...(supportsPlanMode && { planMode: false }),
                  ...(supportsThinking && { thinkingLevel: "low" as ThinkingLevel }),
                };
                if (isStreaming) {
                  onQueue({ content: text, options });
                } else {
                  onSend(text, undefined, options);
                }
              }}
              className="pointer-events-auto rounded border border-dashed border-muted-foreground/30 px-2 py-0.5 text-[11px] text-muted-foreground/40 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/60"
            >
              Commit & Push
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatInput;
