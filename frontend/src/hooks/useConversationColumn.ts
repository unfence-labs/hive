import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/hooks/useApi";
import { useConversation } from "@/hooks/useConversation";
import { useSessions } from "@/hooks/useSessions";
import { useTabs, type UseTabsReturn } from "@/hooks/useTabs";
import { useTasks, type TasksState } from "@/hooks/useTasks";
import { useBackgroundAgents, type BackgroundAgentsState } from "@/hooks/useBackgroundAgents";
import { useGoalState, type GoalState } from "@/hooks/useGoalState";
import type { QueuedMessage, SessionMetadata } from "@/types";

type ConversationApi = ReturnType<typeof useConversation>;

/**
 * Options for {@link useConversationColumn}. Both callbacks model the small,
 * legitimate divergences between WorkspaceView and BrainView so the rest of the
 * orchestration can stay shared.
 */
export interface ConversationColumnOptions {
  /**
   * Invoked when a session tab is activated (after `activateTab` + `switchSession`).
   * WorkspaceView passes a fn that clears the per-session unread badge; Brain omits.
   */
  onActivateSession?: (sessionId: string) => void;
  /**
   * Invoked when the last remaining session is deleted (after `clearChat`).
   * Each page does its own cache cleanup here (Brain just clears the WS cache;
   * WorkspaceView also invalidates the workspace query).
   */
  onLastSessionDeleted?: () => void;
}

/**
 * Aggregated conversation-column orchestration shared by WorkspaceView and
 * BrainView. Returns one cohesive object combining the conversation, sessions,
 * tabs, tasks, and background-agent surfaces, plus a per-session message queue
 * and the standard session create/activate/delete handlers.
 *
 * Queue semantics: the queued follow-up message is stored per
 * `wsId:sessionId`, so switching sessions/workspaces preserves each session's
 * pending message instead of dropping it. It auto-dequeues once the workspace
 * is truly idle (not streaming, status `idle`, no pending tool inputs).
 *
 * Handler semantics:
 * - `handleCreateSession`: create + switch to the new session.
 * - `handleActivateSession`: activate the session tab, then switch; runs
 *   `opts.onActivateSession` for the freshly activated id (no-op if already active).
 * - `handleDeleteSession`: delete; if it was the active session, switch to the
 *   next one, or `clearChat` + `opts.onLastSessionDeleted` when none remain.
 *
 * Plan logic, file-mention handlers, and ChatInput's `onSend` stay per-page.
 */
export interface ConversationColumn
  extends ConversationApi,
    Pick<
      UseTabsReturn,
      | "openFile"
      | "fileViewMode"
      | "diffScope"
      | "isFileTabActive"
      | "activateTab"
      | "openFileTab"
      | "openDiffTab"
      | "setFileViewMode"
      | "setDiffScope"
      | "closeFileTab"
    > {
  // Sessions
  sessions: SessionMetadata[];
  createSession: () => Promise<SessionMetadata | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  refreshSessions: () => void;
  effectiveLockedProvider: string | undefined;
  activeSession: SessionMetadata | undefined;
  /** True while the sessions list is still loading (no cached data yet). */
  sessionsLoading: boolean;

  // Tasks + background agents
  tasks: TasksState["tasks"];
  currentTask: TasksState["currentTask"];
  taskCounts: TasksState["counts"];
  taskTrackerStatus: TasksState["trackerStatus"];
  goal: GoalState | null;
  backgroundAgents: BackgroundAgentsState["agents"];
  backgroundRunningCount: number;

  // Per-session message queue + scroll trigger
  queuedMessage: QueuedMessage | null;
  setQueuedMessage: (msg: QueuedMessage | null) => void;
  scrollToBottomTrigger: number;
  bumpScrollToBottom: () => void;

  // Shared session handlers
  handleCreateSession: () => Promise<void>;
  handleActivateSession: (sessionId: string) => void;
  handleDeleteSession: (sessionId: string) => Promise<void>;
  /**
   * Open a terminal tab. Converts the active session in place when it is an
   * empty chat; otherwise creates a fresh terminal session. Then starts the PTY
   * and activates the tab.
   */
  handleStartTerminal: () => Promise<void>;
}

export function useConversationColumn(
  wsId: string | undefined,
  opts: ConversationColumnOptions = {},
): ConversationColumn {
  const conversation = useConversation(wsId);
  const {
    messages,
    isStreaming,
    workspaceStatus,
    activeToolCalls,
    activeAgentActivities,
    pendingToolInputs,
    sessionId,
    sendMessage,
    clearChat,
    switchSession,
  } = conversation;

  const { sessions, loading: sessionsLoading, createSession, convertToTerminal, deleteSession, refresh: refreshSessions } = useSessions(wsId);

  // Mirror iOS: fall back to session metadata when WS hasn't delivered
  // lockedProvider yet.
  const activeSession = sessions.find((s) => s.sessionId === sessionId);
  const effectiveLockedProvider =
    conversation.lockedProvider ??
    activeSession?.lockedProvider;

  // A session locks its provider and earns its generated title during the first
  // turn, but the sessions list is only fetched on mount/create/delete. Refetch
  // when a turn finishes so the tab strip picks up the now-known provider icon
  // and title without waiting for an unrelated invalidation.
  const wasStreamingRef = useRef(isStreaming);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      refreshSessions();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, refreshSessions]);

  const tabs = useTabs(sessionId, wsId);
  const { activateTab } = tabs;

  const { tasks, currentTask, counts: taskCounts, trackerStatus: taskTrackerStatus } = useTasks(
    messages,
    activeToolCalls,
    activeAgentActivities,
  );
  const goal = useGoalState(messages, activeAgentActivities);
  const { agents: backgroundAgents, runningCount: backgroundRunningCount } = useBackgroundAgents(
    messages,
    activeToolCalls,
  );

  // ── Scroll-to-bottom trigger: incremented on send/queue to force scroll ──
  const [scrollToBottomTrigger, setScrollToBottomTrigger] = useState(0);
  const bumpScrollToBottom = useCallback(() => setScrollToBottomTrigger((c) => c + 1), []);

  // ── Message queue: lets users type one follow-up while agent is busy ──
  // Stored per (workspace, session) so switching sessions/workspaces preserves
  // each session's pending message instead of silently dropping it.
  const [queuedMessages, setQueuedMessages] = useState<Record<string, QueuedMessage>>({});
  const queueKey = wsId && sessionId ? `${wsId}:${sessionId}` : null;
  const queuedMessage = queueKey ? queuedMessages[queueKey] ?? null : null;
  const setQueuedMessage = useCallback(
    (msg: QueuedMessage | null) => {
      if (!queueKey) return;
      setQueuedMessages((prev) => {
        if (msg === null) {
          if (!(queueKey in prev)) return prev;
          const next = { ...prev };
          delete next[queueKey];
          return next;
        }
        return { ...prev, [queueKey]: msg };
      });
    },
    [queueKey],
  );

  // Auto-dequeue when the agent finishes and workspace is truly idle.
  useEffect(() => {
    if (!queuedMessage) return;
    if (isStreaming) return;
    if (workspaceStatus !== "idle") return;
    if (pendingToolInputs.length > 0) return;

    const { content, images, options, fileMentions } = queuedMessage;
    const sent = sendMessage(content, images, options, undefined, fileMentions);
    if (sent) setQueuedMessage(null);
    // If send fails (WS disconnected), keep queue — effect re-fires on reconnect.
  }, [queuedMessage, isStreaming, workspaceStatus, pendingToolInputs, sendMessage, setQueuedMessage]);

  const { onActivateSession, onLastSessionDeleted } = opts;

  const handleCreateSession = useCallback(async () => {
    const meta = await createSession();
    if (meta) switchSession(meta.sessionId);
  }, [createSession, switchSession]);

  const handleActivateSession = useCallback(
    (targetSessionId: string) => {
      activateTab(`session:${targetSessionId}`);
      if (targetSessionId === sessionId) return;
      switchSession(targetSessionId);
      onActivateSession?.(targetSessionId);
    },
    [activateTab, sessionId, switchSession, onActivateSession],
  );

  const handleDeleteSession = useCallback(
    async (targetSessionId: string) => {
      const isActive = targetSessionId === sessionId;
      const success = await deleteSession(targetSessionId);
      if (!success) return;
      if (!isActive) return;

      const next = sessions.find((s) => s.sessionId !== targetSessionId);
      if (next) {
        handleActivateSession(next.sessionId);
      } else {
        clearChat();
        onLastSessionDeleted?.();
      }
    },
    [deleteSession, sessionId, sessions, handleActivateSession, clearChat, onLastSessionDeleted],
  );

  const handleStartTerminal = useCallback(async () => {
    if (!wsId) return;
    let targetId: string;
    // Convert the active session in place when it's an empty chat; otherwise
    // spin up a fresh terminal session so existing chats stay untouched.
    if (
      activeSession &&
      activeSession.kind !== "terminal" &&
      activeSession.messageCount === 0 &&
      sessionId
    ) {
      const converted = await convertToTerminal(sessionId);
      if (!converted) return;
      targetId = sessionId;
    } else {
      const meta = await createSession("terminal");
      if (!meta) return;
      targetId = meta.sessionId;
    }
    // The session is already a terminal (convert is irreversible), so land on
    // the tab no matter what: a failed start must not reject unhandled, and the
    // pane's idle state offers a Start button to retry.
    try {
      await api.post(`/api/workspaces/${wsId}/terminal-tabs/${targetId}/start`);
    } catch {
      // Swallowed — TerminalPane shows the idle/Start state for a retry.
    }
    refreshSessions();
    handleActivateSession(targetId);
  }, [wsId, activeSession, sessionId, convertToTerminal, createSession, refreshSessions, handleActivateSession]);

  return {
    ...conversation,
    // Tabs
    openFile: tabs.openFile,
    fileViewMode: tabs.fileViewMode,
    diffScope: tabs.diffScope,
    isFileTabActive: tabs.isFileTabActive,
    activateTab: tabs.activateTab,
    openFileTab: tabs.openFileTab,
    openDiffTab: tabs.openDiffTab,
    setFileViewMode: tabs.setFileViewMode,
    setDiffScope: tabs.setDiffScope,
    closeFileTab: tabs.closeFileTab,
    // Sessions
    sessions,
    createSession,
    deleteSession,
    refreshSessions,
    effectiveLockedProvider,
    activeSession,
    sessionsLoading,
    // Tasks + background agents
    tasks,
    currentTask,
    taskCounts,
    taskTrackerStatus,
    goal,
    backgroundAgents,
    backgroundRunningCount,
    // Queue + scroll
    queuedMessage,
    setQueuedMessage,
    scrollToBottomTrigger,
    bumpScrollToBottom,
    // Handlers
    handleCreateSession,
    handleActivateSession,
    handleDeleteSession,
    handleStartTerminal,
  };
}
