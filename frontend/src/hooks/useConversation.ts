import { useEffect, useCallback, useReducer, useRef, useSyncExternalStore } from "react";
import type { AgentActivity, ChatMessage, FileMention, ImageAttachment, MessageOptions, ToolCall, WsOutgoing, QuestionAnswer, QuestionInput } from "@/types";
import { wsTransport } from "@/lib/ws-transport";
import type { HistoryMessage } from "@/lib/ws-transport";
import { api } from "@/hooks/useApi";

type StatusMessage = Extract<WsOutgoing, { type: "status" }>;

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

interface ConversationState {
  messages: ChatMessage[];
  sessionStreams: Record<string, SessionStreamState>;
  isResyncing: boolean;
  deferredStatus?: StatusMessage;
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
  | { type: "_ws_resync_started" };

type Action = WsOutgoing | LocalAction;

const initialState: ConversationState = {
  messages: [],
  sessionStreams: {},
  isResyncing: false,
  deferredStatus: undefined,
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

function hasTerminalAssistantMessage(state: ConversationState, sid: string): boolean {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (message.sessionId && message.sessionId !== sid) continue;
    return message.role === "assistant";
  }
  return false;
}

function statusStopsSession(status: StatusMessage | undefined, sessionId: string): boolean {
  if (!status) return false;
  const streaming = status.streaming ?? (status.status === "idle" ? false : undefined);
  return streaming === false && (!status.sessionId || status.sessionId === sessionId);
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
      // Only add to messages if this is the active session
      const isActive = !state.sessionId || sid === state.sessionId;
      const alreadyExists = state.messages.some((m) => m.id === action.message.id);
      const stream = getOrInitStream(state.sessionStreams, sid);
      return {
        ...state,
        messages: isActive && !alreadyExists ? [...state.messages, action.message] : state.messages,
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
        isResyncing: false,
        deferredStatus: undefined,
        sessionId: state.sessionId ?? sid,
        workspaceStatus: "busy",
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
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream) return state;

      const isActive = sid === state.sessionId;
      const newStreams = deleteStream(state, sid);

      if (isActive) {
        const assistantMsg: ChatMessage = {
          id: self.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
          sessionId: sid,
          role: "assistant",
          content: stream.currentText,
          toolCalls: stream.activeToolCalls.length > 0 ? stream.activeToolCalls : undefined,
          agentActivities: stream.activeAgentActivities.length > 0 ? stream.activeAgentActivities : undefined,
          thinkingContent: stream.currentThinking || undefined,
          timestamp: new Date().toISOString(),
          durationMs: action.durationMs,
          inputTokens: action.inputTokens,
          outputTokens: action.outputTokens,
          contextUsedTokens: action.contextUsedTokens,
          contextWindowTokens: action.contextWindowTokens,
        };
        return {
          ...state,
          isResyncing: false,
          deferredStatus: undefined,
          messages: [...state.messages, assistantMsg],
          sessionStreams: newStreams,
        };
      }
      // Background session: just clean up the slot. REST fetch on switch-back
      // will include the completed message.
      return { ...state, isResyncing: false, deferredStatus: undefined, sessionStreams: newStreams };
    }

    case "cancelled": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      const isActive = sid === state.sessionId;

      // Ignore stale cancelled events when there's no stream data.
      if (!stream) return state;
      const hasOutput = stream.currentText.length > 0 || stream.activeToolCalls.length > 0;
      const hasActivity = stream.activeAgentActivities.length > 0;
      const hasThinking = stream.currentThinking.length > 0;
      if (!stream.isStreaming && !hasOutput && !hasActivity && !hasThinking) return state;

      const newStreams = deleteStream(state, sid);

      if (isActive) {
        const cancelledMsg: ChatMessage = {
          id: self.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
          sessionId: sid,
          role: "assistant",
          content: hasOutput ? stream.currentText : CANCELLED_NO_OUTPUT_MESSAGE,
          toolCalls: stream.activeToolCalls.length > 0 ? stream.activeToolCalls : undefined,
          agentActivities: stream.activeAgentActivities.length > 0 ? stream.activeAgentActivities : undefined,
          thinkingContent: stream.currentThinking || undefined,
          timestamp: new Date().toISOString(),
          cancelled: true,
        };
        return {
          ...state,
          isResyncing: false,
          deferredStatus: undefined,
          messages: [...state.messages, cancelledMsg],
          sessionStreams: newStreams,
        };
      }
      return { ...state, isResyncing: false, deferredStatus: undefined, sessionStreams: newStreams };
    }

    case "error":
      if (action.sessionId && state.sessionId && action.sessionId !== state.sessionId) {
        return state;
      }
      return { ...state, error: action.message };

    case "status": {
      if (state.isResyncing) {
        return { ...state, deferredStatus: action };
      }

      const sid = action.sessionId ?? state.sessionId;
      const newIsStreaming = action.streaming ?? (action.status === "idle" ? false : undefined);
      const backendStartedAt = normalizeStreamingStartedAt(action.streamingStartedAt);

      let newStreams = state.sessionStreams;
      if (sid && newIsStreaming !== undefined) {
        const stream = state.sessionStreams[sid];
        if (newIsStreaming) {
          // Session started or is streaming — ensure a slot exists
          const existing = stream ?? { ...emptyStreamState };
          newStreams = {
            ...state.sessionStreams,
            [sid]: {
              ...existing,
              isStreaming: true,
              // A (re)starting turn means any pending question was answered,
              // possibly on another client (e.g. iOS).
              pendingToolInputs: [],
              // Prefer backend-provided start time so all clients show the same timer.
              streamingStartedAt: backendStartedAt ?? existing.streamingStartedAt ?? Date.now(),
            },
          };
        } else if (stream) {
          // Session stopped streaming. If slot has no content, clean up.
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

      // Only adopt sessionId from status if we don't have one yet
      const newSessionId = (!state.sessionId && sid) ? sid : state.sessionId;

      return {
        ...state,
        workspaceStatus: action.status,
        sessionId: newSessionId,
        sessionStreams: newStreams,
        // Only update lockedProvider when explicitly present and for the active session.
        ...(action.lockedProvider !== undefined && sid === newSessionId
          ? { lockedProvider: action.lockedProvider }
          : {}),
      };
    }

    case "history": {
      const historySessionId = action.sessionId ?? action.messages[0]?.sessionId ?? state.sessionId;
      // Only update messages for the active session
      if (historySessionId && state.sessionId && historySessionId !== state.sessionId) {
        return state;
      }

      // Derive pending tool inputs from history, unless the session has an active stream
      const activeStream = historySessionId ? state.sessionStreams[historySessionId] : undefined;
      const deferredStop = historySessionId
        ? statusStopsSession(state.deferredStatus, historySessionId)
        : false;
      const streamStillActive = Boolean(activeStream?.isStreaming && !deferredStop);
      const hydratedPendingToolInputs = streamStillActive && activeStream
        ? activeStream.pendingToolInputs
        : derivePendingToolInputsFromHistory(action.messages);

      let newStreams = state.sessionStreams;
      if (historySessionId && !streamStillActive) {
        if (hydratedPendingToolInputs.length > 0) {
          newStreams = {
            ...state.sessionStreams,
            [historySessionId]: {
              ...emptyStreamState,
              isStreaming: false,
              streamingStartedAt: null,
              pendingToolInputs: hydratedPendingToolInputs,
            },
          };
        } else if (activeStream) {
          newStreams = deleteStream(state, historySessionId);
        }
      }

      return {
        ...state,
        isResyncing: false,
        deferredStatus: undefined,
        messages: action.messages,
        error: undefined,
        sessionId: historySessionId ?? state.sessionId,
        sessionStreams: newStreams,
        workspaceStatus: state.deferredStatus?.status ?? state.workspaceStatus,
        ...(state.deferredStatus?.lockedProvider !== undefined
          ? { lockedProvider: state.deferredStatus.lockedProvider }
          : {}),
      };
    }

    case "tool_input_required": {
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const stream = state.sessionStreams[sid];
      if (!stream && hasTerminalAssistantMessage(state, sid)) return state;
      const nextStream = stream ?? { ...emptyStreamState };
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
      // A client (possibly another device) answered or dismissed the question.
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
        messages: [],
        isResyncing: false,
        deferredStatus: undefined,
        sessionId: action.sessionId,
        error: undefined,
        lockedProvider: undefined,
        switchCounter: state.switchCounter + 1,
        // sessionStreams is untouched — background sessions keep accumulating
      };

    case "prepare_workspace_switch":
      return {
        ...state,
        messages: [],
        isResyncing: false,
        deferredStatus: undefined,
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
        messages: [],
        sessionStreams: sid ? deleteStream(state, sid) : {},
        isResyncing: false,
        deferredStatus: undefined,
        error: undefined,
        sessionId: undefined,
      };
    }

    case "reset":
      return initialState;

    case "_ws_resync_started":
      // Keep the last visible stream intact until the backend provides an
      // authoritative history/snapshot/final event. Status-only bootstrap
      // messages are provisional and must not create an empty intermediate UI.
      return { ...state, isResyncing: true, deferredStatus: undefined };

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
  const historyRequestTokenRef = useRef(0);
  // Track latest sessionId so effect cleanup can read it (refs update during render, before effects).
  const sessionIdRef = useRef<string | undefined>(state.sessionId);
  sessionIdRef.current = state.sessionId;
  const syncSessionHistory = useCallback(async (sessionId: string) => {
    if (!workspaceId || !sessionId) return;
    const historyRequestToken = historyRequestTokenRef.current + 1;
    historyRequestTokenRef.current = historyRequestToken;
    try {
      const messages = await api.get<ChatMessage[]>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/messages`,
      );
      if (historyRequestTokenRef.current !== historyRequestToken) return;
      dispatch({ type: "history", sessionId, messages });
    } catch {
      // Best-effort sync. WS state remains the fallback if this request fails.
    }
  }, [workspaceId]);
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
    const historyRequestToken = historyRequestTokenRef.current + 1;
    historyRequestTokenRef.current = historyRequestToken;

    dispatch({ type: "prepare_workspace_switch" });
    // Pre-set sessionId so the reducer's mismatch guard rejects replayed history
    // for a different session (e.g. from stale lastHistory in the WS transport cache).
    if (savedSession) {
      dispatch({ type: "prepare_session_switch", sessionId: savedSession });
    }

    wsTransport.connect(workspaceId);

    // Skip session-less errors during the synchronous buffer replay — they may be
    // stale from a previous visit (buffered while the user was on another workspace).
    // After onMessage() returns, the flag is cleared and live errors pass through.
    let replayingBuffer = true;
    const { unsubscribe, hadBufferedMessages } = wsTransport.onMessage(workspaceId, (msg) => {
      if (replayingBuffer && msg.type === "error" && !msg.sessionId) {
        return;
      }
      dispatch(msg);
      if ((msg.type === "done" || msg.type === "cancelled") && msg.sessionId) {
        void syncSessionHistory(msg.sessionId);
      }
    });
    replayingBuffer = false;

    const unsubReconnect = wsTransport.onReconnect(workspaceId, () => {
      dispatch({ type: "_ws_resync_started" });
    });

    // Tell the backend to activate the saved session and send its bootstrap.
    if (savedSession) {
      const sent = wsTransport.send(workspaceId, { type: "switch_session", sessionId: savedSession });
      if (sent) historyRequestTokenRef.current += 1;
    }

    // If the transport replayed buffered messages (events that arrived while we were
    // on another workspace), the reducer already has the most current state. Bump the
    // token so the async REST fetch won't overwrite it with potentially stale disk data.
    if (hadBufferedMessages) {
      historyRequestTokenRef.current += 1;
    }

    // REST fallback — only needed on first visit when no cached history exists.
    // On switch-back the transport cache is kept fresh (see effect below), so
    // the WS replay already provides current messages.
    if (!wsTransport.hasCachedHistory(workspaceId)) {
      void (async () => {
        try {
          const url = savedSession
            ? `/api/workspaces/${workspaceId}/sessions/${savedSession}/messages`
            : `/api/workspaces/${workspaceId}/session/messages`;
          const messages = await api.get<ChatMessage[]>(url);
          if (historyRequestTokenRef.current !== historyRequestToken) return;
          dispatch({ type: "history", sessionId: savedSession, messages });
        } catch {
          // History is still best-effort via websocket replay if API fetch fails.
        }
      })();
    }

    return () => {
      // Remember which session was active before leaving this workspace.
      if (workspaceId && sessionIdRef.current) {
        savedSessionByWorkspace.set(workspaceId, sessionIdRef.current);
      }
      if (historyRequestTokenRef.current === historyRequestToken) {
        historyRequestTokenRef.current = historyRequestToken + 1;
      }
      unsubscribe();
      unsubReconnect();
    };
  }, [workspaceId, syncSessionHistory]);

  // Keep the transport's cached history fresh so switch-back replays are current.
  // Fires on history/done/cancelled/user_message — NOT on streaming deltas.
  // Guard: skip writes when workspaceId just changed — React 18 batching means
  // state.messages may transiently hold the *previous* workspace's messages before
  // prepare_workspace_switch commits. Without this, ws-A's messages get written
  // into ws-B's cache, causing residual chat on switch-back.
  const prevCacheWorkspaceRef = useRef(workspaceId);
  useEffect(() => {
    if (prevCacheWorkspaceRef.current !== workspaceId) {
      prevCacheWorkspaceRef.current = workspaceId;
      return;
    }
    if (!workspaceId || !state.sessionId || state.messages.length === 0) return;
    const historyMsg: HistoryMessage = {
      type: "history",
      sessionId: state.sessionId,
      messages: state.messages,
    };
    wsTransport.updateCachedHistory(workspaceId, historyMsg);
  }, [workspaceId, state.sessionId, state.messages]);

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
    historyRequestTokenRef.current += 1;
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
    dispatch({ type: "prepare_session_switch", sessionId });
    dispatch({ type: "status", status: "busy", sessionId, streaming: false });
    historyRequestTokenRef.current += 1;
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
    historyRequestTokenRef.current += 1;
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
      historyRequestTokenRef.current += 1;
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
    historyRequestTokenRef.current += 1;
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
    historyRequestTokenRef.current += 1;
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
    historyRequestTokenRef.current += 1;
  }, [workspaceId, activeStream?.pendingToolInputs, state.sessionId]);

  return {
    messages: state.messages,
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
