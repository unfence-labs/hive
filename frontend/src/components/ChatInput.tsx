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
import { BookOpenIcon, PlusIcon, SquareIcon, ZapIcon } from "lucide-react";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { AutocompletePopup } from "@/components/chat/AutocompletePopup";
import { FileAutocompletePopup } from "@/components/chat/FileAutocompletePopup";
import { MentionHighlightOverlay } from "@/components/chat/MentionHighlightOverlay";
import { ContextRing } from "@/components/chat/ContextRing";
import { ModelSelector } from "@/components/chat/ModelSelector";
import { ThinkingSelector } from "@/components/chat/ThinkingSelector";
import { useCompletions } from "@/hooks/useCompletions";
import { useFileCompletions } from "@/hooks/useFileCompletions";
import { useContextUsage } from "@/hooks/useContextUsage";
import { useModels } from "@/hooks/useModels";
import { useChatInputDraftPersistence } from "@/hooks/useChatInputDraftPersistence";
import { fuzzyMatchFiles, disambiguateDisplayName, type FuzzyResult } from "@/lib/fuzzy-match";
import { filterCompletions } from "@/lib/completion";
import { getStoredComposeOptions, setStoredComposeOptions } from "@/lib/compose-options-store";

export interface ChatInputHandle {
  appendText: (text: string) => void;
}

interface ChatInputProps {
  wsId?: string;
  sessionId?: string;
  /** Server-owned composer seed used only when this input instance mounts. */
  draftPrompt?: string;
  lockedProvider?: string;
  /** Run options of the session's last sent message, used to seed the input
   *  controls. Read at mount as a fallback seed for the composer controls when
   *  the per-session compose-options store is empty (e.g. after a full reload). */
  lastRunOptions?: MessageOptions;
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
  draftPrompt,
  lockedProvider,
  lastRunOptions,
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
  const [value, setValue] = useState(() => draftPrompt ?? "");
  // Seeded at mount from the per-session compose-options store (sticky across
  // conversation switches within a session), falling back to the session's last
  // run, then to defaults. The component is keyed by wsId:sessionId so this
  // re-seeds cleanly on every switch.
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(
    () => getStoredComposeOptions(wsId, sessionId)?.thinkingLevel
      ?? lastRunOptions?.thinkingLevel
      ?? DEFAULT_THINKING_LEVEL,
  );
  const [planMode, setPlanMode] = useState(
    () => getStoredComposeOptions(wsId, sessionId)?.planMode
      ?? lastRunOptions?.planMode
      ?? false,
  );
  const [fastMode, setFastMode] = useState(
    () => getStoredComposeOptions(wsId, sessionId)?.fastMode
      ?? lastRunOptions?.fastMode
      ?? false,
  );
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

  const { models, selectedModelId, selectedModel, setSelectedModelId, capabilities } = useModels(lockedProvider, lastRunOptions?.model);
  const contextUsage = useContextUsage(messages, selectedModel);
  const completionProvider = lockedProvider ?? (selectedModelId ? selectedModelId.split(":")[0] : undefined);

  const thinkingLevels = useMemo<ThinkingLevel[]>(
    () => capabilities?.thinkingLevels ?? [],
    [capabilities?.thinkingLevels],
  );
  const supportsThinking = thinkingLevels.length > 0;
  const supportsPlanMode = capabilities?.planMode ?? true;
  const supportsCompletions = capabilities?.completions ?? true;
  const supportsFastMode = selectedModel?.supportsFastMode ?? false;
  // Never send fastMode when the selected model can't use it (e.g. Sonnet/Haiku).
  const effectiveFastMode = supportsFastMode && fastMode;

  const effectiveThinkingLevel: ThinkingLevel = supportsThinking
    ? (thinkingLevels.includes(thinkingLevel)
        ? thinkingLevel
        : (thinkingLevels.includes(DEFAULT_THINKING_LEVEL) ? DEFAULT_THINKING_LEVEL : thinkingLevels[0]))
    : thinkingLevel;

  const { discardCurrentDraft } = useChatInputDraftPersistence({
    wsId,
    sessionId,
    value,
    attachmentsRef,
    fileMentions,
    setValue,
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

  // Persist composer toggles per conversation so switching sessions and back
  // restores the user's last choice instead of snapping to model defaults.
  useEffect(() => {
    setStoredComposeOptions(wsId, sessionId, { thinkingLevel, planMode, fastMode });
  }, [wsId, sessionId, thinkingLevel, planMode, fastMode]);

  const completionItems = useCompletions(wsId, completionProvider, supportsCompletions);
  const filePaths = useFileCompletions(wsId);

  const filteredItems = useMemo(() => {
    if (!autocomplete || autocomplete.trigger === "#") return [];
    const type = autocomplete.trigger === "/" ? "slash_command" : "agent";
    return filterCompletions(completionItems, type, autocomplete.query);
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
      ...(effectiveFastMode && { fastMode: true }),
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
    discardCurrentDraft();
    setAutocomplete(null);
  };

  const showSlashPopup = autocomplete !== null && autocomplete.trigger !== "#" && filteredItems.length > 0;
  const showFilePopup = autocomplete !== null && autocomplete.trigger === "#" && fileResults.length > 0;

  const activeStyle = "bg-primary/10 text-primary ring-1 ring-primary/15 hover:bg-primary/15 hover:text-primary dark:hover:bg-primary/15";

  return (
    <div className="relative z-50 bg-card p-4">
      <div className={cn(
        "relative rounded-lg border border-transparent [&_[data-slot=input-group]]:!border [&_[data-slot=input-group]]:!border-border/30 [&_[data-slot=input-group]]:!bg-field [&_[data-slot=input-group]]:!shadow-none",
        planMode && supportsPlanMode && "[&_[data-slot=input-group]]:!border-transparent border-dashed border-primary",
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
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
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
              <ThinkingSelector
                levels={thinkingLevels}
                selectedLevel={effectiveThinkingLevel}
                onSelect={setThinkingLevel}
                className={activeStyle}
              />
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
            {supportsFastMode && (
              <PromptInputButton
                aria-label="Toggle fast mode (faster Opus, higher cost)"
                title="Fast mode: faster Opus responses at a higher cost per token"
                variant="ghost"
                size="xs"
                onClick={() => setFastMode((v) => !v)}
                className={cn("h-5 text-[11px] transition-colors", fastMode && activeStyle)}
              >
                <ZapIcon className="size-3" />
                Fast
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
                <SquareIcon className="size-3 text-destructive" />
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
                canSubmit && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
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
