import { useState, useEffect, useCallback, useMemo, useRef, type CSSProperties } from "react";
import { ArrowUpRight, EyeOff, Plus } from "lucide-react";
import { useConversation } from "@/hooks/useConversation";
import { useSessions } from "@/hooks/useSessions";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import QuestionPanel from "@/components/chat/QuestionPanel";
import { PlanActionBar } from "@/components/chat/PlanActionBar";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { BranchLabel } from "@/components/BranchLabel";
import { hasPendingExitPlanModeInput, isPlanAwaitingUserInput, findPlanContent } from "@/lib/plan-state";
import { cn } from "@/lib/utils";
import type { Workspace, QueuedMessage, ImageAttachment, MessageOptions, FileMention } from "@/types";

interface ConversationTileProps {
  wsId: string;
  workspace: Workspace;
  projectLabel?: string;
  onJumpOut: (wsId: string) => void;
  onHide?: (wsId: string) => void;
  onNeedsInputChange?: (wsId: string, needsInput: boolean) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  isDragSource?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function ConversationTile({ wsId, workspace, projectLabel, onJumpOut, onHide, onNeedsInputChange, onHeaderPointerDown, isDragSource, className, style }: ConversationTileProps) {
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
    approvePlan,
    dismissPlan,
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

  // ── Plan detection ──────────────────────────────────────────────
  const hasPendingExitPlanInput = hasPendingExitPlanModeInput(pendingToolInputs);
  const hasPendingPlan = isPlanAwaitingUserInput({ messages, isStreaming, pendingToolInputs });

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
    (content: string, images?: ImageAttachment[], options?: MessageOptions, fileMentions?: FileMention[]): boolean => {
      if (hasPendingPlan && hasPendingExitPlanInput) {
        rejectToolInput(content);
        setScrollToBottomTrigger((c) => c + 1);
        return true;
      }
      const sent = sendMessage(content, images, options, undefined, fileMentions);
      if (sent) setScrollToBottomTrigger((c) => c + 1);
      return sent;
    },
    [hasPendingPlan, hasPendingExitPlanInput, rejectToolInput, sendMessage],
  );

  const handleNewSession = useCallback(async () => {
    const meta = await createSession();
    if (meta) switchSession(meta.sessionId);
  }, [createSession, switchSession]);

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
        {sessions.length > 1 && (
          <div className="flex shrink-0 items-center gap-0.5">
            {sessions.map((s) => (
              <button
                key={s.sessionId}
                type="button"
                onClick={() => switchSession(s.sessionId)}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  s.sessionId === sessionId
                    ? "bg-primary"
                    : "bg-muted-foreground/30 hover:bg-muted-foreground/60",
                )}
                aria-label={`Switch to session ${s.sessionId}`}
                title={s.sessionId === sessionId ? "Current session" : "Switch session"}
              />
            ))}
          </div>
        )}
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
            aria-label={`Remove ${workspace.name}`}
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

      {/* ── Input ────────────────────────────────────────────────── */}
      {hasAskUser ? (
        <QuestionPanel
          pendingToolInputs={pendingToolInputs}
          onBatchSubmit={batchAnswerQuestions}
          onDismiss={() => rejectToolInput("[question_dismissed]")}
        />
      ) : (
        <div className="relative">
          {hasPendingPlan && pendingPlanData && (
            <PlanActionBar
              planContent={pendingPlanData.content}
              planPath={pendingPlanData.planPath}
              onApprove={approvePlan}
              onHandOff={(content, planPath) => {
                dismissPlan("Plan handed off.");
                onJumpOut(wsId);
              }}
            />
          )}
          <ChatInput
            wsId={wsId}
            sessionId={sessionId}
            lockedProvider={lockedProvider}
            onSend={handleSend}
            onStop={stopStreaming}
            disabled={false}
            isStreaming={isStreaming}
            connectionStatus={connectionStatus}
            placeholder={hasPendingPlan ? "Enter your plan adjustments here..." : undefined}
            messages={messages}
            queuedMessage={queuedMessage}
            onQueue={(msg) => {
              setQueuedMessage(msg);
              setScrollToBottomTrigger((c) => c + 1);
            }}
            agentPlanMode={agentPlanMode}
          />
        </div>
      )}
    </div>
  );
}
