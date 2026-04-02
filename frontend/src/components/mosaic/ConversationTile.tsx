import { useState, useEffect, useCallback, useRef, type CSSProperties } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, EyeOff, MessageSquare, Plus, Square } from "lucide-react";
import { useConversation } from "@/hooks/useConversation";
import { useSessions } from "@/hooks/useSessions";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import QuestionPanel from "@/components/chat/QuestionPanel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { BranchLabel } from "@/components/BranchLabel";
import { cn } from "@/lib/utils";
import type { Workspace, QueuedMessage, ImageAttachment, MessageOptions, FileMention } from "@/types";

interface ConversationTileProps {
  wsId: string;
  workspace: Workspace;
  projectLabel?: string;
  onJumpOut: (wsId: string) => void;
  onHide?: (wsId: string) => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  onNeedsInputChange?: (wsId: string, needsInput: boolean) => void;
  className?: string;
  style?: CSSProperties;
}

export function ConversationTile({ wsId, workspace, projectLabel, onJumpOut, onHide, onMoveLeft, onMoveRight, onNeedsInputChange, className, style }: ConversationTileProps) {
  const {
    messages,
    isStreaming,
    streamingStartedAt,
    currentStreamingText,
    currentThinking,
    activeToolCalls,
    pendingToolInputs,
    connectionStatus,
    error,
    workspaceStatus,
    sessionId,
    sendMessage,
    stopStreaming,
    answerQuestion,
    batchAnswerQuestions,
    rejectToolInput,
    agentPlanMode,
    lockedProvider,
    switchCounter,
    switchSession,
  } = useConversation(wsId);

  const { sessions, createSession } = useSessions(wsId);
  const maxSessionsReached = sessions.length >= 4;

  const liveData = useWorkspaceLiveDataContext();
  const wsLive = liveData[wsId];
  const displayBranch = wsLive?.branch || workspace.branch;
  const wsStreaming = wsLive?.streaming ?? false;
  const wsUnread = Object.keys(wsLive?.unreadSessions ?? {}).length > 0;

  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);
  const [inputExpanded, setInputExpanded] = useState(false);
  const inputContainerRef = useRef<HTMLDivElement>(null);

  // ── Border flash on turn completion ─────────────────────────────
  const prevStreamingRef = useRef(wsStreaming);
  const [flashBorder, setFlashBorder] = useState(false);

  useEffect(() => {
    if (prevStreamingRef.current && !wsStreaming && wsUnread) {
      setFlashBorder(true);
      const timer = setTimeout(() => setFlashBorder(false), 1500);
      return () => clearTimeout(timer);
    }
    prevStreamingRef.current = wsStreaming;
  }, [wsStreaming, wsUnread]);

  // ── Needs-input callback for toolbar summary ────────────────────
  const hasAskUser = pendingToolInputs.some((p) => p.toolName === "AskUserQuestion");

  useEffect(() => {
    onNeedsInputChange?.(wsId, hasAskUser);
  }, [wsId, hasAskUser, onNeedsInputChange]);

  // Clean up on unmount
  useEffect(() => {
    return () => onNeedsInputChange?.(wsId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId]);

  useEffect(() => { setQueuedMessage(null); }, [wsId, sessionId]);

  useEffect(() => {
    if (!queuedMessage) return;
    if (isStreaming) return;
    if (workspaceStatus !== "idle") return;
    if (pendingToolInputs.length > 0) return;

    const { content, images, options, fileMentions } = queuedMessage;
    const sent = sendMessage(content, images, options, undefined, fileMentions);
    if (sent) setQueuedMessage(null);
  }, [queuedMessage, isStreaming, workspaceStatus, pendingToolInputs, sendMessage]);

  const handleSend = useCallback(
    (content: string, images?: ImageAttachment[], options?: MessageOptions, fileMentions?: FileMention[]): boolean => {
      const sent = sendMessage(content, images, options, undefined, fileMentions);
      if (sent) {
        setScrollToBottomTrigger((c) => c + 1);
        setInputExpanded(false);
      }
      return sent;
    },
    [sendMessage],
  );

  const handleNewSession = useCallback(async () => {
    const meta = await createSession();
    if (meta) switchSession(meta.sessionId);
  }, [createSession, switchSession]);

  // Collapse input on Escape
  useEffect(() => {
    if (!inputExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setInputExpanded(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [inputExpanded]);

  // Collapse input on click outside
  useEffect(() => {
    if (!inputExpanded) return;
    const handleClick = (e: MouseEvent) => {
      if (inputContainerRef.current && !inputContainerRef.current.contains(e.target as Node)) {
        setInputExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [inputExpanded]);

  const showMoveButtons = onMoveLeft || onMoveRight;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden transition-shadow duration-500",
        flashBorder && "ring-2 ring-primary/60 shadow-[0_0_12px_var(--hive-accent)]",
        className,
      )}
      style={style}
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-card px-1.5">
        {/* Reorder arrows */}
        {showMoveButtons && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={onMoveLeft}
              disabled={!onMoveLeft}
              className={cn(
                "rounded p-0.5 text-muted-foreground/40 transition-colors",
                onMoveLeft ? "hover:text-muted-foreground hover:bg-muted" : "opacity-0 pointer-events-none",
              )}
              title="Move left"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onMoveRight}
              disabled={!onMoveRight}
              className={cn(
                "rounded p-0.5 text-muted-foreground/40 transition-colors",
                onMoveRight ? "hover:text-muted-foreground hover:bg-muted" : "opacity-0 pointer-events-none",
              )}
              title="Move right"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {wsStreaming ? (
            <AgentActivityPreview size="small" />
          ) : wsUnread ? (
            <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
          ) : (
            <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
          )}
          {projectLabel && (
            <>
              <span className="shrink-0 text-[10px] text-muted-foreground/60">{projectLabel}</span>
              <span className="text-muted-foreground/30">/</span>
            </>
          )}
          <span className="truncate text-xs font-medium">{workspace.name}</span>
          {displayBranch && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <BranchLabel
                branch={displayBranch}
                showIcon={false}
                className="text-xs text-muted-foreground truncate"
              />
            </>
          )}
        </div>
        {!maxSessionsReached && (
          <button
            type="button"
            onClick={handleNewSession}
            className="shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label="New session"
            title="New session"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        {onHide && (
          <button
            type="button"
            onClick={() => onHide(wsId)}
            className="shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label={`Hide ${workspace.name}`}
            title="Remove tile"
          >
            <EyeOff className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onJumpOut(wsId)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Open ${workspace.name} full view`}
          title="Open full view"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Conversation ─────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatConversation
          messages={messages}
          isStreaming={isStreaming}
          streamingStartedAt={streamingStartedAt}
          currentStreamingText={currentStreamingText}
          currentThinking={currentThinking}
          activeToolCalls={activeToolCalls}
          pendingToolInputs={pendingToolInputs}
          onQuestionAnswer={answerQuestion}
          workspaceName={workspace.name}
          branch={displayBranch}
          switchCounter={switchCounter}
          agentPlanMode={agentPlanMode}
          error={error}
          queuedMessage={queuedMessage}
          onClearQueue={() => setQueuedMessage(null)}
          scrollToBottomTrigger={scrollToBottomTrigger}
          compactMode
        />
      </div>

      {/* ── Input area ───────────────────────────────────────────── */}
      {hasAskUser ? (
        <QuestionPanel
          pendingToolInputs={pendingToolInputs}
          onBatchSubmit={batchAnswerQuestions}
          onDismiss={() => rejectToolInput("[question_dismissed]")}
        />
      ) : inputExpanded ? (
        <div ref={inputContainerRef}>
          <ChatInput
            wsId={wsId}
            sessionId={sessionId}
            lockedProvider={lockedProvider}
            onSend={handleSend}
            onStop={stopStreaming}
            disabled={false}
            isStreaming={isStreaming}
            connectionStatus={connectionStatus}
            messages={messages}
            queuedMessage={queuedMessage}
            onQueue={(msg) => {
              setQueuedMessage(msg);
              setScrollToBottomTrigger((c) => c + 1);
            }}
            agentPlanMode={agentPlanMode}
          />
        </div>
      ) : (
        /* Collapsed input bar */
        <div
          className="flex h-9 shrink-0 cursor-text items-center gap-2 border-t border-border bg-background px-3 text-sm text-muted-foreground/50 transition-colors hover:bg-muted/30 hover:text-muted-foreground/70"
          onClick={() => setInputExpanded(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setInputExpanded(true);
          }}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-xs">Send a message...</span>
          <div className="flex-1" />
          {isStreaming && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                stopStreaming();
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Stop"
              title="Stop"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          )}
          {queuedMessage && (
            <span className="shrink-0 rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
              Queued
            </span>
          )}
        </div>
      )}
    </div>
  );
}
