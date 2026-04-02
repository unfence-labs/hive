import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { useConversation } from "@/hooks/useConversation";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import ChatConversation from "@/components/ChatConversation";
import QuestionPanel from "@/components/chat/QuestionPanel";
import AgentActivityPreview from "@/components/chat/AgentActivityPreview";
import { BranchLabel } from "@/components/BranchLabel";
import { CompactChatInput } from "@/components/mosaic/CompactChatInput";
import { cn } from "@/lib/utils";
import type { Workspace, QueuedMessage } from "@/types";

interface ConversationTileProps {
  wsId: string;
  workspace: Workspace;
  onJumpOut: (wsId: string) => void;
  onNeedsInputChange?: (wsId: string, needsInput: boolean) => void;
  className?: string;
}

export function ConversationTile({ wsId, workspace, onJumpOut, onNeedsInputChange, className }: ConversationTileProps) {
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
    switchCounter,
  } = useConversation(wsId);

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

    const { content } = queuedMessage;
    const sent = sendMessage(content);
    if (sent) setQueuedMessage(null);
  }, [queuedMessage, isStreaming, workspaceStatus, pendingToolInputs, sendMessage]);

  const handleSend = useCallback(
    (content: string): boolean => {
      const sent = sendMessage(content);
      if (sent) setScrollToBottomTrigger((c) => c + 1);
      return sent;
    },
    [sendMessage],
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden transition-shadow duration-500",
        flashBorder && "ring-2 ring-primary/60 shadow-[0_0_12px_var(--hive-accent)]",
        className,
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-2.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {wsStreaming ? (
            <AgentActivityPreview size="small" />
          ) : wsUnread ? (
            <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_theme(colors.emerald.400)]" />
          ) : (
            <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />
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

      {hasAskUser ? (
        <QuestionPanel
          pendingToolInputs={pendingToolInputs}
          onBatchSubmit={batchAnswerQuestions}
          onDismiss={() => rejectToolInput("[question_dismissed]")}
        />
      ) : (
        <CompactChatInput
          onSend={handleSend}
          onStop={stopStreaming}
          isStreaming={isStreaming}
          connectionStatus={connectionStatus}
          queuedMessage={queuedMessage}
          onQueue={(msg) => {
            setQueuedMessage(msg);
            setScrollToBottomTrigger((c) => c + 1);
          }}
        />
      )}
    </div>
  );
}
