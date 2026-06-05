import { useCallback, useEffect, useState } from "react";
import { useConversation } from "@/hooks/useConversation";
import { useSessions } from "@/hooks/useSessions";
import { useWorkspaceLiveDataContext } from "@/contexts/WorkspaceLiveDataContext";
import { useTasks } from "@/hooks/useTasks";
import { useBackgroundAgents } from "@/hooks/useBackgroundAgents";
import ChatConversation from "@/components/ChatConversation";
import ChatInput from "@/components/ChatInput";
import QuestionPanel from "@/components/chat/QuestionPanel";
import { ConversationTabs } from "@/components/ConversationTabs";
import TaskTracker from "@/components/TaskTracker";
import { wsTransport } from "@/lib/ws-transport";
import { BRAIN_WORKSPACE_ID } from "@/lib/brain";
import type { FileMention, ImageAttachment, MessageOptions, QueuedMessage } from "@/types";

/**
 * Brain agent chat panel. Reuses the workspace conversation machinery
 * (`useConversation`, `useSessions`, `ConversationTabs`, `ChatConversation`,
 * `ChatInput`) pointed at the synthetic `"brain"` workspace, so the agent can
 * read and write Brain notes while the editor refreshes from the WS stream.
 */
export function BrainChatPanel() {
  const {
    messages,
    isStreaming,
    streamingStartedAt,
    workspaceStatus,
    currentStreamingText,
    currentThinking,
    activeToolCalls,
    activeAgentActivities,
    pendingToolInputs,
    connectionStatus,
    error,
    sessionId,
    sendMessage,
    stopStreaming,
    clearChat,
    switchSession,
    answerQuestion,
    batchAnswerQuestions,
    rejectToolInput,
    agentPlanMode,
    lockedProvider,
    switchCounter,
  } = useConversation(BRAIN_WORKSPACE_ID);

  const { sessions, createSession, deleteSession } = useSessions(BRAIN_WORKSPACE_ID);
  const liveData = useWorkspaceLiveDataContext();

  const effectiveLockedProvider =
    lockedProvider ?? sessions.find((s) => s.sessionId === sessionId)?.lockedProvider;

  const { tasks, currentTask, counts: taskCounts } = useTasks(
    messages,
    activeToolCalls,
    activeAgentActivities,
  );
  const { agents: backgroundAgents, runningCount: bgRunningCount } = useBackgroundAgents(
    messages,
    activeToolCalls,
  );

  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);

  // Single-message queue: lets the user type one follow-up while the agent is
  // busy; auto-dispatched when the session goes idle.
  const [queuedMessage, setQueuedMessage] = useState<QueuedMessage | null>(null);
  useEffect(() => {
    if (!queuedMessage || isStreaming || workspaceStatus !== "idle") return;
    if (pendingToolInputs.length > 0) return;
    const { content, images, options, fileMentions } = queuedMessage;
    const sent = sendMessage(content, images, options, undefined, fileMentions);
    if (sent) setQueuedMessage(null);
  }, [queuedMessage, isStreaming, workspaceStatus, pendingToolInputs, sendMessage]);

  const handleCreateSession = useCallback(async () => {
    const meta = await createSession();
    if (meta) switchSession(meta.sessionId);
  }, [createSession, switchSession]);

  const handleActivateSession = useCallback(
    (targetSessionId: string) => {
      if (targetSessionId === sessionId) return;
      switchSession(targetSessionId);
    },
    [sessionId, switchSession],
  );

  const handleDeleteSession = useCallback(
    async (targetSessionId: string) => {
      const isActive = targetSessionId === sessionId;
      const success = await deleteSession(targetSessionId);
      if (!success) return;
      if (isActive) {
        const next = sessions.find((s) => s.sessionId !== targetSessionId);
        if (next) {
          switchSession(next.sessionId);
        } else {
          clearChat();
          wsTransport.clearCachedData(BRAIN_WORKSPACE_ID);
        }
      }
    },
    [deleteSession, sessionId, sessions, switchSession, clearChat],
  );

  const handleSend = useCallback(
    (
      content: string,
      images?: ImageAttachment[],
      options?: MessageOptions,
      fileMentions?: FileMention[],
    ): boolean => {
      const sent = sendMessage(content, images, options, undefined, fileMentions);
      if (sent) setScrollToBottomTrigger((c) => c + 1);
      return sent;
    },
    [sendMessage],
  );

  const showQuestion = pendingToolInputs.some((p) => p.toolName === "AskUserQuestion");

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <ConversationTabs
        sessions={sessions}
        activeSessionId={sessionId}
        isStreaming={isStreaming}
        streamingSessions={liveData[BRAIN_WORKSPACE_ID]?.streamingSessions}
        unreadSessions={liveData[BRAIN_WORKSPACE_ID]?.unreadSessions}
        onCreateSession={handleCreateSession}
        onActivateSession={handleActivateSession}
        onDeleteSession={handleDeleteSession}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatConversation
          messages={messages}
          isStreaming={isStreaming}
          streamingStartedAt={streamingStartedAt}
          currentStreamingText={currentStreamingText}
          currentThinking={currentThinking}
          activeToolCalls={activeToolCalls}
          activeAgentActivities={activeAgentActivities}
          pendingToolInputs={pendingToolInputs}
          onQuestionAnswer={answerQuestion}
          projectName="Brain"
          switchCounter={switchCounter}
          agentPlanMode={agentPlanMode}
          error={error}
          queuedMessage={queuedMessage}
          onClearQueue={() => setQueuedMessage(null)}
          scrollToBottomTrigger={scrollToBottomTrigger}
        />
        {(tasks.length > 0 || backgroundAgents.length > 0) && !showQuestion && (
          <TaskTracker
            tasks={tasks}
            currentTask={currentTask}
            counts={taskCounts}
            isStreaming={isStreaming}
            backgroundAgents={backgroundAgents}
            backgroundRunningCount={bgRunningCount}
          />
        )}
        {showQuestion ? (
          <QuestionPanel
            pendingToolInputs={pendingToolInputs}
            onBatchSubmit={batchAnswerQuestions}
            onDismiss={() => rejectToolInput("[question_dismissed]")}
          />
        ) : (
          <ChatInput
            wsId={BRAIN_WORKSPACE_ID}
            sessionId={sessionId}
            lockedProvider={effectiveLockedProvider}
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
        )}
      </div>
    </div>
  );
}
