import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from "react";
import { ArrowUpRight, EyeOff, Plus } from "lucide-react";
import { useConversation } from "@/hooks/useConversation";
import { useSessionMessages } from "@/hooks/useSessionMessages";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import ChatConversation from "@/components/ChatConversation";
import { CompactChatInput } from "@/components/mosaic/CompactChatInput";
import QuestionPanel from "@/components/chat/QuestionPanel";
import { PlanActionBar } from "@/components/chat/PlanActionBar";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { BranchLabel } from "@/components/BranchLabel";
import { hasPendingExitPlanModeInput, isPlanAwaitingUserInput, findPlanContent } from "@/lib/plan-state";
import { cn } from "@/lib/utils";
import type { Workspace, QueuedMessage, ToolCall } from "@/types";
import type { PendingToolInput } from "@/hooks/useConversation";

const EMPTY_TOOL_CALLS: ToolCall[] = [];
const EMPTY_PENDING_INPUTS: PendingToolInput[] = [];

interface ConversationTileProps {
  wsId: string;
  workspace: Workspace;
  pinnedSessionId?: string;
  sessionTitle?: string;
  onJumpOut: (wsId: string) => void;
  onHide?: () => void;
  onNewSession?: (wsId: string) => void;
  onNeedsInputChange?: (tileId: string, needsInput: boolean) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  isDragSource?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ConversationTile({
  wsId,
  workspace,
  pinnedSessionId,
  sessionTitle,
  onJumpOut,
  onHide,
  onNewSession,
  onNeedsInputChange,
  onHeaderPointerDown,
  isDragSource,
  className,
  style,
}: ConversationTileProps) {
  const conversation = useConversation(wsId);

  // Read-only mode: tile is pinned to a specific (non-active) session
  const isReadOnly = !!pinnedSessionId;
  const pinnedHistory = useSessionMessages(wsId, pinnedSessionId ?? null);

  // Choose data source based on mode
  const messages = isReadOnly ? pinnedHistory.messages : conversation.messages;
  const isStreaming = isReadOnly ? false : conversation.isStreaming;
  const activeToolCalls = isReadOnly ? EMPTY_TOOL_CALLS : conversation.activeToolCalls;
  const pendingToolInputs = isReadOnly ? EMPTY_PENDING_INPUTS : conversation.pendingToolInputs;

  const liveData = useWorkspaceLiveDataContext();
  const wsLive = liveData[wsId];
  const displayBranch = wsLive?.branch || workspace.branch;
  const wsStreaming = isReadOnly ? false : (wsLive?.streaming ?? false);
  const wsUnread = isReadOnly ? false : Object.keys(wsLive?.unreadSessions ?? {}).length > 0;

  // Derive a stable tile ID for callbacks
  const tileId = pinnedSessionId ? `${wsId}:${pinnedSessionId}` : `${wsId}:${conversation.sessionId ?? ""}`;

  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);

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
    onNeedsInputChange?.(tileId, hasAskUser);
  }, [tileId, hasAskUser, onNeedsInputChange]);

  useEffect(() => {
    return () => onNeedsInputChange?.(tileId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileId]);

  useEffect(() => { setQueuedMessage(null); }, [wsId, conversation.sessionId]);

  useEffect(() => {
    if (isReadOnly) return;
    if (!queuedMessage) return;
    if (conversation.isStreaming) return;
    if (conversation.workspaceStatus !== "idle") return;
    if (conversation.pendingToolInputs.length > 0) return;

    const { content, images, options, fileMentions } = queuedMessage;
    const sent = conversation.sendMessage(content, images, options, undefined, fileMentions);
    if (sent) setQueuedMessage(null);
  }, [isReadOnly, queuedMessage, conversation]);

  // ── Plan detection (live tiles only) ───────────────────────────
  const hasPendingExitPlanInput = isReadOnly ? false : hasPendingExitPlanModeInput(pendingToolInputs);
  const hasPendingPlan = isReadOnly ? false : isPlanAwaitingUserInput({
    messages: conversation.messages,
    isStreaming: conversation.isStreaming,
    pendingToolInputs: conversation.pendingToolInputs,
  });

  const pendingPlanData = useMemo(() => {
    if (!hasPendingPlan) return undefined;
    if (activeToolCalls.some((t) => t.name === "ExitPlanMode")) {
      return findPlanContent(activeToolCalls);
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.toolCalls?.some((t) => t.name === "ExitPlanMode")) {
        return findPlanContent(msg.toolCalls);
      }
    }
    return undefined;
  }, [hasPendingPlan, messages, activeToolCalls]);

  const handleSend = useCallback(
    (content: string): boolean => {
      if (hasPendingPlan && hasPendingExitPlanInput) {
        conversation.rejectToolInput(content);
        setScrollToBottomTrigger((c) => c + 1);
        return true;
      }
      const sent = conversation.sendMessage(content);
      if (sent) setScrollToBottomTrigger((c) => c + 1);
      return sent;
    },
    [hasPendingPlan, hasPendingExitPlanInput, conversation],
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden transition-shadow duration-500",
        flashBorder && "ring-2 ring-primary/60 shadow-[0_0_12px_var(--hive-accent)]",
        className,
      )}
      style={style}
    >
      {/* ── Header (drag handle) ─────────────────────────────────── */}
      <div
        className={cn(
          "flex h-8 shrink-0 items-center gap-1.5 border-b border-border bg-card px-1.5 select-none",
          onHeaderPointerDown && "cursor-grab",
          isDragSource && "cursor-grabbing",
        )}
        onPointerDown={onHeaderPointerDown}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {wsStreaming ? (
            <AgentActivityPreview size="small" />
          ) : wsUnread ? (
            <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
          ) : (
            <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
          )}
          {displayBranch && (
            <BranchLabel
              branch={displayBranch}
              showIcon={false}
              className="shrink-0 text-xs font-medium truncate"
            />
          )}
          {sessionTitle && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate text-xs text-muted-foreground">{sessionTitle}</span>
            </>
          )}
          {isReadOnly && (
            <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-medium text-muted-foreground">
              Read-only
            </span>
          )}
        </div>
        {!isReadOnly && onNewSession && (
          <button
            type="button"
            onClick={() => onNewSession(wsId)}
            className="shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label="New conversation"
            title="New conversation"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="shrink-0 rounded p-0.5 text-muted-foreground/40 transition-colors hover:bg-muted hover:text-muted-foreground"
            aria-label={`Hide ${workspace.name}`}
            title="Hide tile"
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
          streamingStartedAt={isReadOnly ? null : conversation.streamingStartedAt}
          currentStreamingText={isReadOnly ? "" : conversation.currentStreamingText}
          currentThinking={isReadOnly ? "" : conversation.currentThinking}
          activeToolCalls={activeToolCalls}
          pendingToolInputs={pendingToolInputs}
          onQuestionAnswer={conversation.answerQuestion}
          workspaceName={workspace.name}
          branch={displayBranch}
          switchCounter={isReadOnly ? 0 : conversation.switchCounter}
          agentPlanMode={isReadOnly ? false : conversation.agentPlanMode}
          error={isReadOnly ? undefined : conversation.error}
          queuedMessage={isReadOnly ? null : queuedMessage}
          onClearQueue={() => setQueuedMessage(null)}
          scrollToBottomTrigger={scrollToBottomTrigger}
          compactMode
        />
      </div>

      {/* ── Input (live tiles only) ─────────────────────────────── */}
      {isReadOnly ? (
        <div className="shrink-0 border-t border-border bg-card/50 px-3 py-1.5 text-center text-[10px] text-muted-foreground/60">
          Read-only session
        </div>
      ) : hasAskUser ? (
        <QuestionPanel
          pendingToolInputs={pendingToolInputs}
          onBatchSubmit={conversation.batchAnswerQuestions}
          onDismiss={() => conversation.rejectToolInput("[question_dismissed]")}
        />
      ) : (
        <div className="relative">
          {hasPendingPlan && pendingPlanData && (
            <PlanActionBar
              planContent={pendingPlanData.content}
              planPath={pendingPlanData.planPath}
              onApprove={conversation.approvePlan}
              onHandOff={() => {
                conversation.dismissPlan("Plan handed off.");
                onJumpOut(wsId);
              }}
            />
          )}
          <CompactChatInput
            onSend={handleSend}
            onStop={conversation.stopStreaming}
            isStreaming={conversation.isStreaming}
            connectionStatus={conversation.connectionStatus}
            placeholder={hasPendingPlan ? "Enter your plan adjustments here..." : undefined}
            queuedMessage={queuedMessage}
            onQueue={(msg) => {
              setQueuedMessage(msg);
              setScrollToBottomTrigger((c) => c + 1);
            }}
          />
        </div>
      )}
    </div>
  );
}
