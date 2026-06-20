import type { ReactNode } from "react";
import ChatConversation from "@/components/ChatConversation";
import QuestionPanel from "@/components/chat/QuestionPanel";
import { ConversationTabs } from "@/components/ConversationTabs";
import TaskTracker from "@/components/TaskTracker";
import type { GoalState } from "@/hooks/useGoalState";
import type { FileViewMode } from "@/hooks/useTabs";
import type { TaskCounts, TaskTrackerStatus, TrackedTask } from "@/hooks/useTasks";
import type { BackgroundAgent } from "@/hooks/useBackgroundAgents";
import type { PendingToolInput } from "@/hooks/useConversation";
import type {
  AgentActivity,
  ChatMessage,
  QueuedMessage,
  QuestionAnswer,
  SessionMetadata,
  ToolCall,
} from "@/types";

/**
 * Shared chat-body layout for WorkspaceView and BrainView: the conversation
 * tab strip, then a body (hidden — not unmounted — while a file tab is active)
 * containing the conversation transcript, an optional task tracker, and a
 * footer that switches between the AskUserQuestion panel and the chat input.
 *
 * Page-specific pieces stay in slots: the page builds its own `<ChatInput>`
 * (divergent `onSend`/`onQueue`/ref/placeholder) and, for WorkspaceView, its
 * `<PlanActionBar>`. The input footer is wrapped in a `relative` container so
 * the (absolutely-positioned) plan action bar floats above the input; Brain
 * passes no `planActionBar`, leaving the wrapper behaviorally inert. The
 * file-tab takeover itself is rendered by the page, not here.
 */
export interface ConversationPaneProps {
  // ── Tabs ──
  sessions: SessionMetadata[];
  activeSessionId?: string;
  isStreaming: boolean;
  streamingSessions?: Record<string, boolean>;
  unreadSessions?: Record<string, boolean>;
  onCreateSession: () => void;
  onActivateSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  openFile?: string | null;
  isFileTabActive?: boolean;
  fileViewMode?: FileViewMode;
  onFileTabActivate?: () => void;
  onFileTabClose?: () => void;
  onConversationActivate?: () => void;
  /** Live provider of the active session, used as the tab icon before the
   * sessions list refetches the locked provider. */
  activeProvider?: string;

  // ── Conversation (ChatConversation surface) ──
  messages: ChatMessage[];
  hasMore?: boolean;
  onLoadEarlier?: () => void;
  streamingStartedAt?: number | null;
  currentStreamingText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  activeAgentActivities: AgentActivity[];
  pendingToolInputs: PendingToolInput[];
  onQuestionAnswer?: (toolCallId: string, answers: QuestionAnswer[]) => void;
  onFileMentionClick?: (relativePath: string) => void;
  switchCounter: number;
  agentPlanMode?: boolean;
  error?: string;
  queuedMessage?: QueuedMessage | null;
  onClearQueue?: () => void;
  scrollToBottomTrigger: number;
  // Page-specific conversation meta (optional; Brain sets only projectName).
  workspaceName?: string;
  projectName?: string;
  branch?: string;
  defaultBranch?: string;
  fileCount?: number;
  /** Page-specific empty-state content (Brain welcome); see {@link ChatConversation}. */
  emptyState?: ReactNode;

  // ── Tasks + background agents ──
  goal?: GoalState | null;
  tasks: TrackedTask[];
  currentTask: TrackedTask | undefined;
  taskCounts: TaskCounts;
  taskTrackerStatus?: TaskTrackerStatus;
  backgroundAgents: BackgroundAgent[];
  backgroundRunningCount: number;

  // ── Question footer ──
  onBatchAnswerQuestions: QuestionPanelBatchSubmit;
  onDismissQuestion: () => void;

  // ── Slots ──
  chatInput: ReactNode;
  planActionBar?: ReactNode;
  /** Full-pane terminal surface, rendered in place of the chat body when the
   * active session is a terminal-kind session. */
  terminalView?: ReactNode;
  /** Opens a terminal tab from the workspace empty state. */
  onStartTerminal?: () => void;
}

type QuestionPanelBatchSubmit = React.ComponentProps<typeof QuestionPanel>["onBatchSubmit"];

export function ConversationPane({
  sessions,
  activeSessionId,
  isStreaming,
  streamingSessions,
  unreadSessions,
  onCreateSession,
  onActivateSession,
  onDeleteSession,
  openFile,
  isFileTabActive,
  fileViewMode,
  onFileTabActivate,
  onFileTabClose,
  onConversationActivate,
  activeProvider,
  messages,
  hasMore,
  onLoadEarlier,
  streamingStartedAt,
  currentStreamingText,
  currentThinking,
  activeToolCalls,
  activeAgentActivities,
  pendingToolInputs,
  onQuestionAnswer,
  onFileMentionClick,
  switchCounter,
  agentPlanMode,
  error,
  queuedMessage,
  onClearQueue,
  scrollToBottomTrigger,
  workspaceName,
  projectName,
  branch,
  defaultBranch,
  fileCount,
  emptyState,
  goal,
  tasks,
  currentTask,
  taskCounts,
  taskTrackerStatus,
  backgroundAgents,
  backgroundRunningCount,
  onBatchAnswerQuestions,
  onDismissQuestion,
  chatInput,
  planActionBar,
  terminalView,
  onStartTerminal,
}: ConversationPaneProps) {
  const showQuestion = pendingToolInputs.some((p) => p.toolName === "AskUserQuestion");
  const activeIsTerminal =
    sessions.find((s) => s.sessionId === activeSessionId)?.kind === "terminal";

  return (
    <>
      <ConversationTabs
        sessions={sessions}
        activeSessionId={activeSessionId}
        isStreaming={isStreaming}
        streamingSessions={streamingSessions}
        unreadSessions={unreadSessions}
        onCreateSession={onCreateSession}
        onActivateSession={onActivateSession}
        onDeleteSession={onDeleteSession}
        openFile={openFile}
        isFileTabActive={isFileTabActive}
        fileViewMode={fileViewMode}
        onFileTabActivate={onFileTabActivate}
        onFileTabClose={onFileTabClose}
        onConversationActivate={onConversationActivate}
        activeProvider={activeProvider}
      />
      <div className={!isFileTabActive ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        {activeIsTerminal ? (
          terminalView
        ) : (
          <>
            <ChatConversation
              messages={messages}
              hasMore={hasMore}
              onLoadEarlier={onLoadEarlier}
              isStreaming={isStreaming}
              streamingStartedAt={streamingStartedAt}
              currentStreamingText={currentStreamingText}
              currentThinking={currentThinking}
              activeToolCalls={activeToolCalls}
              activeAgentActivities={activeAgentActivities}
              pendingToolInputs={pendingToolInputs}
              onQuestionAnswer={onQuestionAnswer}
              onFileMentionClick={onFileMentionClick}
              onStartTerminal={onStartTerminal}
              workspaceName={workspaceName}
              projectName={projectName}
              branch={branch}
              defaultBranch={defaultBranch}
              fileCount={fileCount}
              emptyState={emptyState}
              switchCounter={switchCounter}
              agentPlanMode={agentPlanMode}
              error={error}
              queuedMessage={queuedMessage}
              onClearQueue={onClearQueue}
              scrollToBottomTrigger={scrollToBottomTrigger}
            />
            {(goal || tasks.length > 0 || backgroundAgents.length > 0) && !showQuestion && (
              <TaskTracker
                goal={goal}
                tasks={tasks}
                currentTask={currentTask}
                counts={taskCounts}
                trackerStatus={taskTrackerStatus}
                isStreaming={isStreaming}
                backgroundAgents={backgroundAgents}
                backgroundRunningCount={backgroundRunningCount}
              />
            )}
            {showQuestion ? (
              <QuestionPanel
                pendingToolInputs={pendingToolInputs}
                onBatchSubmit={onBatchAnswerQuestions}
                onDismiss={onDismissQuestion}
              />
            ) : (
              <div className="relative">
                {planActionBar}
                {chatInput}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
