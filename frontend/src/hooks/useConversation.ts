import { useEffect, useCallback, useReducer, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentActivity, ChatMessage, FileMention, ImageAttachment, MessageOptions, ToolCall, WsOutgoing, QuestionAnswer, QuestionInput } from "@/types";
import { wsTransport } from "@/lib/ws-transport";
import {
  useSessionMessages,
  getCachedSessionMessages,
  appendCachedSessionMessage,
  invalidateSessionMessages,
} from "@/hooks/useSessionMessages";

export interface PendingToolInput {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: unknown;
}

interface SessionStreamState {
  currentText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  activeAgentActivities: AgentActivity[];
  isStreaming: boolean;
  streamingStartedAt: number | null;
  pendingToolInputs: PendingToolInput[];
  agentPlanMode?: boolean;
}

const emptyStreamState: SessionStreamState = {
  currentText: "",
  currentThinking: "",
  activeToolCalls: [],
  activeAgentActivities: [],
  isStreaming: false,
  streamingStartedAt: null,
  pendingToolInputs: [],
};

// Finalized messages are owned by React Query (see useSessionMessages). The
// reducer below tracks LIVE state only: per-session in-progress streams, status,
// pending tool inputs, and the active session id.
interface ConversationState {
  sessionStreams: Record<string, SessionStreamState>;
  workspaceStatus?: "idle" | "busy";
  error?: string;
  sessionId?: string;
  lockedProvider?: string;
  switchCounter: number;
}

const CANCELLED_NO_OUTPUT_MESSAGE = "Generation interrupted before any output.";

type LocalAction =
  | { type: "reset" }
  | { type: "clear_chat" }
  | { type: "prepare_session_switch"; sessionId: string }
  | { type: "prepare_workspace_switch" }
  | { type: "clear_pending_tool_inputs" }
  // Reconcile live stream slots against newly-loaded REST history (derive a
  // pending question from the last turn / drop a stale finished stream slot).
  | { type: "reconcile_history"; sessionId: string; messages: ChatMessage[] };

type Action = WsOutgoing | LocalAction;

const initialState: ConversationState = {
  sessionStreams: {},
  workspaceStatus: undefined,
  error: undefined,
  sessionId: undefined,
  switchCounter: 0,
};

function parseToolInput(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return {};
  }
}

function newMessageId(): string {
  return self.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function normalizeStreamingStartedAt(raw: number | undefined): number | undefined {
  if (raw === undefined || Number.isNaN(raw)) return undefined;
  // Backend currently sends ms, but accept seconds defensively.
  return raw > 10_000_000_000 ? raw : raw * 1000;
}

function derivePendingToolInputsFromHistory(messages: ChatMessage[]): PendingToolInput[] {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) return [];

  const hasUserAfterLastAssistant = messages
    .slice(lastAssistantIdx + 1)
    .some((message) => message.role === "user");
  if (hasUserAfterLastAssistant) return [];

  const toolCalls = messages[lastAssistantIdx]?.toolCalls ?? [];
  return toolCalls
    .filter((tool) => tool.name === "AskUserQuestion" || tool.name === "ExitPlanMode")
    .map((tool) => ({
      requestId: `history-${tool.id}`,
      toolName: tool.name,
      toolUseId: tool.id,
      input: parseToolInput(tool.input),
    }));
}

/** Whether the last message for a session is a terminal assistant turn. */
function lastMessageIsTerminalAssistant(messages: ChatMessage[], sid: string): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.sessionId && message.sessionId !== sid) continue;
    return message.role === "assistant";
  }
  return false;
}

/** Build the finalized assistant message from a stream slot on done/cancelled. */
function buildFinalizedMessage(
  stream: SessionStreamState,
  sid: string,
  msg: Extract<WsOutgoing, { type: "done" } | { type: "cancelled" }>,
): ChatMessage | null {
  const hasOutput = stream.currentText.length > 0 || stream.activeToolCalls.length > 0;
  const toolCalls = stream.activeToolCalls.length > 0 ? stream.activeToolCalls : undefined;
  const agentActivities = stream.activeAgentActivities.length > 0 ? stream.activeAgentActivities : undefined;
  const thinkingContent = stream.currentThinking || undefined;

  if (msg.type === "cancelled") {
    const hasActivity = stream.activeAgentActivities.length > 0;
    const hasThinking = stream.currentThinking.length > 0;
    // Ignore a stale cancelled with no accumulated data.
    if (!stream.isStreaming && !hasOutput && !hasActivity && !hasThinking) return null;
    return {
      id: newMessageId(),
      sessionId: sid,
      role: "assistant",
      content: hasOutput ? stream.currentText : CANCELLED_NO_OUTPUT_MESSAGE,
      toolCalls,
      agentActivities,
      thinkingContent,
      timestamp: new Date().toISOString(),
      cancelled: true,
    };
  }

  return {
    id: newMessageId(),
    sessionId: sid,
    role: "assistant",
    content: stream.currentText,
    toolCalls,
    agentActivities,
    thinkingContent,
    timestamp: new Date().toISOString(),
    durationMs: msg.durationMs,
    inputTokens: msg.inputTokens,
    outputTokens: msg.outputTokens,
    contextUsedTokens: msg.contextUsedTokens,
    contextWindowTokens: msg.contextWindowTokens,
  };
}

/** Return or create the stream slot for an explicit stream start. */
function getOrInitStream(streams: Record<string, SessionStreamState>, sid: string): SessionStreamState {
  return streams[sid] ?? { ...emptyStreamState, isStreaming: true, streamingStartedAt: Date.now() };
}

function updateStream(
  state: ConversationState,
  sid: string,
  patch: Partial<SessionStreamState>,
): ConversationState {
  const stream = state.sessionStreams[sid];
  if (!stream) return state;
  return {
    ...state,
    sessionStreams: {
      ...state.sessionStreams,
      [sid]: { ...stream, ...patch },
    },
  };
}

function deleteStream(state: ConversationState, sid: string): Record<string, SessionStreamState> {
  const copy = { ...state.sessionStreams };
  delete copy[sid];
  return copy;
}

function upsertActivity(activities: AgentActivity[], activity: AgentActivity): AgentActivity[] {
  const index = activities.findIndex((item) => item.id === activity.id);
  if (index < 0) return [...activities, activity];
  return activities.map((item, itemIndex) => itemIndex === index ? activity : item);
}

function reducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case "user_message": {
      const sid = action.message.sessionId || state.sessionId;
      if (!sid) return state;
      const isActive = !state.sessionId || sid === state.sessionId;
      const stream = getOrInitStream(state.sessionStreams, sid);
      return {
        ...state,
        sessionStreams: {
          ...state.sessionStreams,
          [sid]: {
            ...stream,
            isStreaming: true,
            streamingStartedAt: stream.streamingStartedAt ?? Date.now(),
            currentText: "",
            currentThinking: "",
            activeToolCalls: [],
            activeAgentActivities: [],
            pendingToolInputs: [],
          },
        },
        error: isActive ? undefined : state.error,
        sessionId: state.sessionId ?? sid,
      };
    }

    case "text_delta": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream) return state;
      return updateStream(state, sid, { currentText: stream.currentText + action.text });
    }

    case "thinking": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream) return state;
      return updateStream(state, sid, { currentThinking: stream.currentThinking + action.text });
    }

    case "tool_use": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream) return state;
      return updateStream(state, sid, {
        activeToolCalls: [
          ...stream.activeToolCalls,
          { id: action.id, name: action.name, input: action.input, parentToolUseId: action.parentToolUseId },
        ],
      });
    }

    case "tool_result": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream) return state;
      const tools = stream.activeToolCalls.map((t) =>
        t.id === action.toolUseId ? { ...t, output: action.output } : t,
      );
      return updateStream(state, sid, { activeToolCalls: tools });
    }

    case "agent_activity": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream) return state;
      return updateStream(state, sid, {
        activeAgentActivities: upsertActivity(stream.activeAgentActivities, action.activity),
      });
    }

    case "stream_snapshot": {
      const sid = action.sessionId;
      const existing = state.sessionStreams[sid] ?? { ...emptyStreamState };
      const backendStartedAt = normalizeStreamingStartedAt(action.streamingStartedAt);
      return {
        ...state,
        sessionId: state.sessionId ?? sid,
        sessionStreams: {
          ...state.sessionStreams,
          [sid]: {
            ...existing,
            currentText: action.text,
            currentThinking: action.thinking,
            activeToolCalls: action.toolCalls,
            activeAgentActivities: action.agentActivities,
            isStreaming: true,
            streamingStartedAt: backendStartedAt ?? existing.streamingStartedAt ?? Date.now(),
            pendingToolInputs: [],
            agentPlanMode: action.agentPlanMode,
          },
        },
      };
    }

    case "done": {
      // The finalized message is appended to the React Query cache by the WS
      // handler before this dispatch; here we only clear the live slot.
      const sid = action.sessionId || state.sessionId;
      if (!sid || !state.sessionStreams[sid]) return state;
      return { ...state, sessionStreams: deleteStream(state, sid) };
    }

    case "cancelled": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream) return state;
      const hasOutput = stream.currentText.length > 0 || stream.activeToolCalls.length > 0;
      const hasActivity = stream.activeAgentActivities.length > 0;
      const hasThinking = stream.currentThinking.length > 0;
      // Ignore stale cancelled events when there's no stream data.
      if (!stream.isStreaming && !hasOutput && !hasActivity && !hasThinking) return state;
      return { ...state, sessionStreams: deleteStream(state, sid) };
    }

    case "error":
      if (action.sessionId && state.sessionId && action.sessionId !== state.sessionId) {
        return state;
      }
      return { ...state, error: action.message };

    case "status": {
      const sid = action.sessionId ?? state.sessionId;
      const newIsStreaming = action.streaming ?? (action.status === "idle" ? false : undefined);
      const backendStartedAt = normalizeStreamingStartedAt(action.streamingStartedAt);

      let newStreams = state.sessionStreams;
      if (sid && newIsStreaming !== undefined) {
        const stream = state.sessionStreams[sid];
        if (newIsStreaming) {
          const existing = stream ?? { ...emptyStreamState };
          newStreams = {
            ...state.sessionStreams,
            [sid]: {
              ...existing,
              isStreaming: true,
              // A (re)starting turn means any pending question was answered,
              // possibly on another client (e.g. iOS).
              pendingToolInputs: [],
              streamingStartedAt: backendStartedAt ?? existing.streamingStartedAt ?? Date.now(),
            },
          };
        } else if (stream) {
          if (
            !stream.currentText &&
            !stream.currentThinking &&
            stream.activeToolCalls.length === 0 &&
            stream.activeAgentActivities.length === 0 &&
            stream.pendingToolInputs.length === 0
          ) {
            newStreams = deleteStream(state, sid);
          } else {
            newStreams = {
              ...state.sessionStreams,
              [sid]: { ...stream, isStreaming: false, streamingStartedAt: null },
            };
          }
        }
      }

      const newSessionId = (!state.sessionId && sid) ? sid : state.sessionId;

      return {
        ...state,
        workspaceStatus: action.status,
        sessionId: newSessionId,
        sessionStreams: newStreams,
        ...(action.lockedProvider !== undefined && sid === newSessionId
          ? { lockedProvider: action.lockedProvider }
          : {}),
      };
    }

    case "reconcile_history": {
      const sid = action.sessionId;
      if (!sid || (state.sessionId && sid !== state.sessionId)) return state;
      const activeStream = state.sessionStreams[sid];
      // During an active stream the live WS state wins — leave it untouched.
      if (activeStream?.isStreaming) return state;

      const derived = derivePendingToolInputsFromHistory(action.messages);
      if (derived.length > 0) {
        return {
          ...state,
          sessionStreams: {
            ...state.sessionStreams,
            [sid]: { ...emptyStreamState, pendingToolInputs: derived },
          },
        };
      }
      // No pending question and a stale finished slot lingers → drop it so it is
      // not rendered as a duplicate bubble alongside the now-persisted message.
      if (activeStream) {
        return { ...state, sessionStreams: deleteStream(state, sid) };
      }
      return state;
    }

    case "tool_input_required": {
      // The terminal-assistant guard (ignore a question already closed in
      // history) lives in the WS handler, which has the REST messages.
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const nextStream = state.sessionStreams[sid] ?? { ...emptyStreamState };
      return {
        ...state,
        sessionStreams: {
          ...state.sessionStreams,
          [sid]: {
            ...nextStream,
            pendingToolInputs: [...nextStream.pendingToolInputs, {
              requestId: action.requestId,
              toolName: action.toolName,
              toolUseId: action.toolUseId,
              input: action.input,
            }],
          },
        },
      };
    }

    case "tool_input_resolved": {
      const stream = state.sessionStreams[action.sessionId];
      if (!stream || stream.pendingToolInputs.length === 0) return state;
      return updateStream(state, action.sessionId, { pendingToolInputs: [] });
    }

    case "plan_mode_changed": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      return updateStream(state, sid, { agentPlanMode: action.active });
    }

    case "clear_pending_tool_inputs": {
      const sid = state.sessionId;
      if (!sid || !state.sessionStreams[sid]) return state;
      return updateStream(state, sid, { pendingToolInputs: [] });
    }

    case "prepare_session_switch":
      return {
        ...state,
        sessionId: action.sessionId,
        error: undefined,
        lockedProvider: undefined,
        switchCounter: state.switchCounter + 1,
        // sessionStreams is untouched — background sessions keep accumulating
      };

    case "prepare_workspace_switch":
      return {
        ...state,
        sessionId: undefined,
        workspaceStatus: undefined,
        error: undefined,
        lockedProvider: undefined,
        switchCounter: state.switchCounter + 1,
        // sessionStreams is untouched — all sessions keep accumulating
      };

    case "clear_chat": {
      const sid = state.sessionId;
      return {
        ...state,
        sessionStreams: sid ? deleteStream(state, sid) : {},
        error: undefined,
        sessionId: undefined,
      };
    }

    case "reset":
      return initialState;

    default:
      return state;
  }
}

/** Remembers which session was last viewed per workspace (module-level, survives re-mounts). */
const savedSessionByWorkspace = new Map<string, string>();

/** Pre-seed the session to restore when navigating to a workspace. */
export function setSavedSession(workspaceId: string, sessionId: string) {
  savedSessionByWorkspace.set(workspaceId, sessionId);
}

/** @internal Test-only: clear saved session memory between tests. */
export function _resetSavedSessions() {
  savedSessionByWorkspace.clear();
}

function sessionIdField(id: string | undefined): { sessionId: string } | Record<string, never> {
  return id ? { sessionId: id } : {};
}

export function useConversation(workspaceId: string | undefined) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const queryClient = useQueryClient();

  // Finalized messages for the active session — owned by React Query (REST).
  const { messages } = useSessionMessages(workspaceId, state.sessionId);

  // Track latest state so the WS handler (set up once per workspace) can read the
  // current stream content and session id without re-subscribing.
  const stateRef = useRef(state);
  stateRef.current = state;
  const sessionIdRef = useRef<string | undefined>(state.sessionId);
  sessionIdRef.current = state.sessionId;

  const connectionStatus = useSyncExternalStore(
    (listener) =>
      workspaceId ? wsTransport.subscribe(workspaceId, listener) : () => {},
    () => (workspaceId ? wsTransport.getStatus(workspaceId) : "disconnected"),
  );

  useEffect(() => {
    if (!workspaceId) {
      dispatch({ type: "reset" });
      return;
    }
    const savedSession = savedSessionByWorkspace.get(workspaceId);

    dispatch({ type: "prepare_workspace_switch" });
    // Pre-set sessionId so the messages query targets the restored session.
    if (savedSession) {
      dispatch({ type: "prepare_session_switch", sessionId: savedSession });
    }

    wsTransport.connect(workspaceId);

    // Skip session-less errors during the synchronous buffer replay — they may be
    // stale from a previous visit (buffered while the user was on another workspace).
    let replayingBuffer = true;
    const { unsubscribe } = wsTransport.onMessage(workspaceId, (msg) => {
      if (replayingBuffer && msg.type === "error" && !msg.sessionId) {
        return;
      }

      // Ignore a tool_input_required for a question already closed in history
      // (no live stream, last persisted turn is a terminal assistant).
      if (msg.type === "tool_input_required") {
        const sid = msg.sessionId ?? stateRef.current.sessionId;
        if (sid && !stateRef.current.sessionStreams[sid]) {
          const cached = getCachedSessionMessages(queryClient, workspaceId, sid);
          if (cached && lastMessageIsTerminalAssistant(cached, sid)) return;
        }
      }

      // Append finalized turns to the React Query cache from the live stream
      // BEFORE the reducer clears the slot, then refetch the authoritative copy.
      if (msg.type === "done" || msg.type === "cancelled") {
        const sid = msg.sessionId ?? stateRef.current.sessionId;
        const stream = sid ? stateRef.current.sessionStreams[sid] : undefined;
        if (sid && stream) {
          const finalized = buildFinalizedMessage(stream, sid, msg);
          if (finalized) appendCachedSessionMessage(queryClient, workspaceId, sid, finalized);
        }
        if (sid) invalidateSessionMessages(queryClient, workspaceId, sid);
      }

      if (msg.type === "user_message") {
        const sid = msg.message.sessionId ?? stateRef.current.sessionId;
        appendCachedSessionMessage(queryClient, workspaceId, sid, msg.message);
      }

      dispatch(msg);
    });
    replayingBuffer = false;

    // Tell the backend to activate the saved session and send its (live) bootstrap.
    if (savedSession) {
      wsTransport.send(workspaceId, { type: "switch_session", sessionId: savedSession });
    }

    return () => {
      if (workspaceId && sessionIdRef.current) {
        savedSessionByWorkspace.set(workspaceId, sessionIdRef.current);
      }
      unsubscribe();
    };
  }, [workspaceId, queryClient]);

  // Reconcile live stream slots whenever the REST history for the active session
  // changes (new fetch). Keyed on the messages reference — does NOT re-run on
  // unrelated renders, so an imperatively-cleared pending question stays cleared.
  useEffect(() => {
    if (!state.sessionId) return;
    dispatch({ type: "reconcile_history", sessionId: state.sessionId, messages });
  }, [messages, state.sessionId]);

  const sendMessage = useCallback((
    content: string,
    images?: ImageAttachment[],
    options?: MessageOptions,
    sessionId?: string,
    fileMentions?: FileMention[],
  ): boolean => {
    if (!workspaceId) {
      dispatch({ type: "error", message: "Message not sent: no workspace selected." });
      return false;
    }
    const targetSessionId = sessionId ?? state.sessionId;
    const sent = wsTransport.send(workspaceId, {
      type: "user_message",
      content,
      images: images?.length ? images : undefined,
      fileMentions: fileMentions?.length ? fileMentions : undefined,
      options,
      ...sessionIdField(targetSessionId),
    });
    if (!sent) {
      dispatch({ type: "error", message: "Message not sent: disconnected from server." });
      return false;
    }
    return true;
  }, [workspaceId, state.sessionId]);

  const stopStreaming = useCallback(() => {
    if (!workspaceId) return;
    wsTransport.send(workspaceId, {
      type: "stop",
      ...sessionIdField(state.sessionId),
    });
  }, [workspaceId, state.sessionId]);

  const clearChat = useCallback(() => {
    dispatch({ type: "clear_chat" });
  }, []);

  const switchSession = useCallback((sessionId: string) => {
    if (!workspaceId) return;
    // Switching the session re-keys the messages query, which returns cached
    // history instantly (no empty flash) and revalidates in the background.
    dispatch({ type: "prepare_session_switch", sessionId });
    const sent = wsTransport.send(workspaceId, { type: "switch_session", sessionId });
    if (!sent) {
      dispatch({ type: "error", message: "Session switch failed: disconnected from server." });
    }
  }, [workspaceId]);

  // Derive active session's stream state for the public API
  const activeStream = state.sessionId ? state.sessionStreams[state.sessionId] : undefined;

  const answerQuestion = useCallback((toolCallId: string, answers: QuestionAnswer[]) => {
    if (!workspaceId) return;
    const pendingInputs = activeStream?.pendingToolInputs ?? [];
    const pending = pendingInputs.find((p) => p.toolUseId === toolCallId);
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending?.requestId ?? toolCallId,
      toolName: "AskUserQuestion",
      result: { type: "answer", answers },
      ...sessionIdField(state.sessionId),
    });
    dispatch({ type: "clear_pending_tool_inputs" });
  }, [workspaceId, activeStream?.pendingToolInputs, state.sessionId]);

  const batchAnswerQuestions = useCallback(
    (responses: Array<{ toolUseId: string; answers: QuestionAnswer[] }>) => {
      if (!workspaceId) return;
      const pendingInputs = activeStream?.pendingToolInputs ?? [];
      for (const { toolUseId, answers } of responses) {
        const pending = pendingInputs.find((p) => p.toolUseId === toolUseId);
        const input = pending?.input as { questions?: QuestionInput[] } | undefined;
        wsTransport.send(workspaceId, {
          type: "tool_input_response",
          requestId: pending?.requestId ?? toolUseId,
          toolName: "AskUserQuestion",
          result: { type: "answer", answers, questions: input?.questions },
          ...sessionIdField(state.sessionId),
        });
      }
      dispatch({ type: "clear_pending_tool_inputs" });
    },
    [workspaceId, activeStream?.pendingToolInputs, state.sessionId],
  );

  const approvePlan = useCallback(() => {
    if (!workspaceId) return;
    const pendingInputs = activeStream?.pendingToolInputs ?? [];
    const pending = pendingInputs.find((p) => p.toolName === "ExitPlanMode");
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending?.requestId ?? "",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
      ...sessionIdField(state.sessionId),
    });
    dispatch({ type: "clear_pending_tool_inputs" });
    dispatch({ type: "plan_mode_changed", sessionId: state.sessionId ?? "", active: false });
  }, [workspaceId, activeStream?.pendingToolInputs, state.sessionId]);

  const rejectToolInput = useCallback((message?: string) => {
    const pendingInputs = activeStream?.pendingToolInputs ?? [];
    if (!workspaceId || pendingInputs.length === 0) return;
    const pending = pendingInputs[0];
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending.requestId,
      toolName: pending.toolName,
      result: { type: "reject", message },
      ...sessionIdField(state.sessionId),
    });
    dispatch({ type: "clear_pending_tool_inputs" });
  }, [workspaceId, activeStream?.pendingToolInputs, state.sessionId]);

  const dismissPlan = useCallback((message?: string) => {
    if (!workspaceId) return;
    const pendingInputs = activeStream?.pendingToolInputs ?? [];
    const pending = pendingInputs.find((p) => p.toolName === "ExitPlanMode");
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending?.requestId ?? "",
      toolName: "ExitPlanMode",
      result: { type: "dismiss", message },
      ...sessionIdField(state.sessionId),
    });
    if (pending) {
      dispatch({ type: "clear_pending_tool_inputs" });
    }
  }, [workspaceId, activeStream?.pendingToolInputs, state.sessionId]);

  return {
    messages,
    isStreaming: activeStream?.isStreaming ?? false,
    streamingStartedAt: activeStream?.streamingStartedAt ?? null,
    workspaceStatus: state.workspaceStatus,
    currentStreamingText: activeStream?.currentText ?? "",
    currentThinking: activeStream?.currentThinking ?? "",
    activeToolCalls: activeStream?.activeToolCalls ?? [],
    activeAgentActivities: activeStream?.activeAgentActivities ?? [],
    pendingToolInputs: activeStream?.pendingToolInputs ?? [],
    connectionStatus,
    error: state.error,
    sessionId: state.sessionId,
    agentPlanMode: activeStream?.agentPlanMode,
    lockedProvider: state.lockedProvider,
    switchCounter: state.switchCounter,
    sendMessage,
    stopStreaming,
    clearChat,
    switchSession,
    answerQuestion,
    batchAnswerQuestions,
    approvePlan,
    rejectToolInput,
    dismissPlan,
  };
}
