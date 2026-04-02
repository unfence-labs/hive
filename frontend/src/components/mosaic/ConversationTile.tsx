import { useState, useEffect, useCallback } from "react";
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
  className?: string;
}

export function ConversationTile({ wsId, workspace, onJumpOut, className }: ConversationTileProps) {
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

  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);

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

  const hasAskUser = pendingToolInputs.some((p) => p.toolName === "AskUserQuestion");

  return (
    <div className={cn("flex flex-col overflow-hidden", className)}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-2.5">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {wsStreaming ? (
            <AgentActivityPreview size="small" />
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
          projectName={workspace.projectName}
          branch={displayBranch}
          defaultBranch={workspace.defaultBranch}
          switchCounter={switchCounter}
          agentPlanMode={agentPlanMode}
          error={error}
          queuedMessage={queuedMessage}
          onClearQueue={() => setQueuedMessage(null)}
          scrollToBottomTrigger={scrollToBottomTrigger}
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
