import { useEffect, useCallback, useReducer, useRef, useSyncExternalStore } from "react";
import type {
  AgentActivity,
  ChatMessage,
  FileMention,
  ImageAttachment,
  MessageOptions,
  SessionMessagesResponse,
  ToolCall,
  WsOutgoing,
  QuestionAnswer,
  QuestionInput,
} from "@/types";
import { normalizeToolOutput, outputByteLength, outputLineCount } from "@hive/shared/agent-activity";
import { wsTransport } from "@/lib/ws-transport";
import { api } from "@/hooks/useApi";

/** Default page size for the REST history endpoint (matches the backend default). */
const HISTORY_LIMIT = 200;

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
  /** Whether older messages exist before `messages[0]` (drives "Load earlier"). */
  hasMore: boolean;
  sessionStreams: Record<string, SessionStreamState>;
  workspaceStatus?: "idle" | "busy";
  error?: string;
  sessionId?: string;
  lockedProvider?: string;
  switchCounter: number;
}

const CANCELLED_NO_OUTPUT_MESSAGE = "Generation interrupted before any output.";

/** REST-sourced history actions (the socket no longer carries history). */
type LocalAction =
  | { type: "reset" }
  | { type: "clear_chat" }
  | { type: "prepare_session_switch"; sessionId: string }
  | { type: "prepare_workspace_switch" }
  | { type: "clear_pending_tool_inputs" }
  | { type: "set_history"; sessionId?: string; messages: ChatMessage[]; hasMore: boolean }
  | { type: "prepend_history"; sessionId: string; beforeId: string; messages: ChatMessage[]; hasMore: boolean };

type Action = WsOutgoing | LocalAction;

const initialState: ConversationState = {
  messages: [],
  hasMore: false,
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

function normalizeStreamingStartedAt(raw: number | undefined): number | undefined {
  if (raw === undefined || Number.isNaN(raw)) return undefined;
  // Backend currently sends ms, but accept seconds defensively.
  return raw > 10_000_000_000 ? raw : raw * 1000;
}

/**
 * Compute the unified output scalars from a full tool output, so the collapsed
 * render path reads scalars uniformly (live and history) without re-parsing the
 * body. Live outputs are never truncated, hence `outputTruncated: false`.
 */
function computeOutputScalars(rawOutput: unknown): Pick<
  ToolCall,
  "output" | "outputPreview" | "outputLineCount" | "outputByteLength" | "outputTruncated"
> {
  const output = normalizeToolOutput(rawOutput);
  return {
    output,
    outputPreview: output,
    outputLineCount: outputLineCount(output),
    outputByteLength: outputByteLength(output),
    outputTruncated: false,
  };
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
      // Live output is full: compute the unified scalars once here so render
      // reads scalars uniformly (one render path for live and history).
      const scalars = computeOutputScalars(action.output);
      const tools = stream.activeToolCalls.map((t) =>
        t.id === action.toolUseId ? { ...t, ...scalars } : t,
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
      // Consolidated in-flight snapshot with REPLACE semantics. Idempotent:
      // applying it twice yields identical state. Create the slot if absent.
      const sid = action.sessionId || state.sessionId;
      if (!sid) return state;
      const existing = state.sessionStreams[sid] ?? { ...emptyStreamState };
      // Snapshot tools carry full outputs (live = full). Compute the unified
      // scalars here, once, exactly like the tool_result path so mid-stream-join
      // tools render via scalars (one render path, live and history) instead of
      // re-parsing the full body until the next REST resync.
      const snapshotToolCalls = action.toolCalls.map((tool) =>
        tool.output !== undefined ? { ...tool, ...computeOutputScalars(tool.output) } : tool,
      );
      return {
        ...state,
        sessionStreams: {
          ...state.sessionStreams,
          [sid]: {
            ...existing,
            currentText: action.text,
            currentThinking: action.thinking,
            activeToolCalls: snapshotToolCalls,
            activeAgentActivities: action.agentActivities,
            agentPlanMode: action.planMode,
            isStreaming: true,
            streamingStartedAt:
              normalizeStreamingStartedAt(action.streamingStartedAt) ??
              existing.streamingStartedAt ??
              Date.now(),
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

      // Append the optimistic assistant message under the SERVER message id so
      // the next REST history fetch dedups by id (no client random id). The
      // presence of messageId is the single signal that the turn had displayable
      // content: an empty turn omits it, so no empty bubble is appended.
      const alreadyExists = state.messages.some((m) => m.id === action.messageId);
      if (isActive && action.messageId && !alreadyExists) {
        const assistantMsg: ChatMessage = {
          id: action.messageId,
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
          messages: [...state.messages, assistantMsg],
          sessionStreams: newStreams,
        };
      }
      // Background session, empty turn, or already-present id: just clean up the
      // slot. The REST fetch on switch-back / revalidation carries the message.
      return { ...state, sessionStreams: newStreams };
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
        // Use the server message id when the turn was persisted (so the REST
        // fetch dedups); otherwise fall back to a local id (an unpersisted
        // cancellation is never in REST history, so it cannot duplicate).
        const id = action.messageId ?? `cancelled-${sid}-${Date.now()}`;
        const alreadyExists = state.messages.some((m) => m.id === id);
        if (alreadyExists) return { ...state, sessionStreams: newStreams };
        const cancelledMsg: ChatMessage = {
          id,
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
          messages: [...state.messages, cancelledMsg],
          sessionStreams: newStreams,
        };
      }
      return { ...state, sessionStreams: newStreams };
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

    case "set_history": {
      const messages = Array.isArray(action.messages) ? action.messages : [];
      const historySessionId = action.sessionId ?? messages[0]?.sessionId ?? state.sessionId;
      // Only update messages for the active session (sessionId-match guard
      // replaces the old request-token juggling).
      if (historySessionId && state.sessionId && historySessionId !== state.sessionId) {
        return state;
      }

      // Derive pending tool inputs from history, unless the session has an active stream
      const activeStream = historySessionId ? state.sessionStreams[historySessionId] : undefined;
      const hydratedPendingToolInputs = activeStream?.isStreaming
        ? activeStream.pendingToolInputs
        : derivePendingToolInputsFromHistory(messages);

      let newStreams = state.sessionStreams;
      if (historySessionId && !activeStream?.isStreaming) {
        if (activeStream || hydratedPendingToolInputs.length > 0) {
          newStreams = {
            ...state.sessionStreams,
            [historySessionId]: {
              ...(activeStream ?? { ...emptyStreamState }),
              pendingToolInputs: hydratedPendingToolInputs,
            },
          };
        }
      }

      return {
        ...state,
        messages,
        hasMore: action.hasMore,
        error: undefined,
        sessionId: historySessionId ?? state.sessionId,
        sessionStreams: newStreams,
      };
    }

    case "prepend_history": {
      // "Load earlier messages" — prepend an older window, dedup by id.
      if (state.sessionId && action.sessionId !== state.sessionId) return state;
      if (state.messages[0]?.id !== action.beforeId) return state;
      const incoming = Array.isArray(action.messages) ? action.messages : [];
      const existingIds = new Set(state.messages.map((m) => m.id));
      const older = incoming.filter((m) => !existingIds.has(m.id));
      return {
        ...state,
        messages: [...older, ...state.messages],
        hasMore: action.hasMore,
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
        hasMore: false,
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
        hasMore: false,
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
        hasMore: false,
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
  // Track latest sessionId so effect cleanup / async callbacks can read it
  // (refs update during render, before effects).
  const sessionIdRef = useRef<string | undefined>(state.sessionId);
  sessionIdRef.current = state.sessionId;
  // Invalidates an in-flight initial history fetch when the user sends a message
  // or switches session before it resolves, so a stale empty response can't
  // clobber freshly produced optimistic/live state. (Targeted single guard,
  // replacing the old multi-site request-token juggling.)
  const fetchSeqRef = useRef(0);
  // Orders same-session replacement history fetches. `fetchSeqRef` invalidates
  // across user actions/session switches; this one prevents an older REST
  // response for the same session from overwriting a newer one.
  const replaceHistorySeqRef = useRef(0);

  // ── Coalesced streaming deltas ──────────────────────────────────────
  // Batch text_delta/thinking on a ~50ms tick (rAF where available) instead of
  // dispatching per token, to cap the streaming re-render rate. The buffer is a
  // small per-session accumulator flushed before any ordering-sensitive event.
  const deltaBufferRef = useRef<Map<string, { text: string; thinking: string }>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDeltas = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const buffer = deltaBufferRef.current;
    if (buffer.size === 0) return;
    deltaBufferRef.current = new Map();
    for (const [sid, { text, thinking }] of buffer) {
      if (text) dispatch({ type: "text_delta", sessionId: sid, text });
      if (thinking) dispatch({ type: "thinking", sessionId: sid, text: thinking });
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushDeltas();
    }, 50);
  }, [flushDeltas]);

  const bufferDelta = useCallback(
    (sid: string, key: "text" | "thinking", value: string) => {
      const buffer = deltaBufferRef.current;
      const entry = buffer.get(sid) ?? { text: "", thinking: "" };
      entry[key] += value;
      buffer.set(sid, entry);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  /** Fetch a session's latest message window and replace local history. */
  const syncSessionHistory = useCallback(async (sessionId: string) => {
    if (!workspaceId || !sessionId) return;
    // Capture the request generation synchronously; if the user switches/sends
    // before this resolves, the generation advances and we drop the stale result.
    const seq = fetchSeqRef.current;
    const replaceSeq = ++replaceHistorySeqRef.current;
    try {
      const res = await api.get<SessionMessagesResponse>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/messages?limit=${HISTORY_LIMIT}`,
      );
      if (fetchSeqRef.current !== seq) return;
      if (replaceHistorySeqRef.current !== replaceSeq) return;
      dispatch({ type: "set_history", sessionId, messages: res.messages, hasMore: res.hasMore });
    } catch {
      // Best-effort sync. WS live state remains the fallback if this request fails.
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

    dispatch({ type: "prepare_workspace_switch" });
    // Pre-set sessionId so the reducer's mismatch guard rejects history for a
    // different session during rapid switches.
    if (savedSession) {
      dispatch({ type: "prepare_session_switch", sessionId: savedSession });
    }

    wsTransport.connect(workspaceId);

    // Stale-while-revalidate: render the last known window immediately so
    // switch-back feels instant, then revalidate via REST below.
    if (savedSession) {
      const cached = wsTransport.getSessionWindow(workspaceId, savedSession);
      if (cached) {
        dispatch({
          type: "set_history",
          sessionId: savedSession,
          messages: cached.messages,
          hasMore: cached.hasMore,
        });
      }
    }

    // Skip session-less errors during the synchronous buffer replay — they may be
    // stale from a previous visit (buffered while the user was on another workspace).
    // After onMessage() returns, the flag is cleared and live errors pass through.
    let replayingBuffer = true;
    const { unsubscribe, hadBufferedMessages } = wsTransport.onMessage(workspaceId, (msg) => {
      if (replayingBuffer && msg.type === "error" && !msg.sessionId) {
        return;
      }
      // Coalesce streaming deltas; flush before any ordering-sensitive event so
      // buffered text lands before tool calls / completion.
      if (msg.type === "text_delta") {
        bufferDelta(msg.sessionId ?? sessionIdRef.current ?? "", "text", msg.text);
        return;
      }
      if (msg.type === "thinking") {
        bufferDelta(msg.sessionId ?? sessionIdRef.current ?? "", "thinking", msg.text);
        return;
      }
      flushDeltas();
      dispatch(msg);
      if ((msg.type === "done" || msg.type === "cancelled") && msg.sessionId) {
        void syncSessionHistory(msg.sessionId);
      }
    });
    replayingBuffer = false;

    // On reconnect, re-pull focus: re-send switch_session so the backend replays
    // a fresh consolidated stream_snapshot (replace semantics make this safe and
    // idempotent — no clear-state hack needed). With no active session id, send a
    // bare switch_session so the backend resolves the active session and still
    // pulls its in-flight snapshot.
    const unsubReconnect = wsTransport.onReconnect(workspaceId, () => {
      wsTransport.send(workspaceId, {
        type: "switch_session",
        ...sessionIdField(sessionIdRef.current),
      });
      // The switch_session above only re-pulls the live snapshot, and the
      // backend sends a stream_snapshot only if the session is STILL streaming.
      // A turn that COMPLETED while the socket was down is never delivered, so
      // refetch REST history to pull any finalized turn from the disconnect
      // window. set_history replaces finalized messages; the snapshot (if any)
      // repopulates the live slot — the two don't fight.
      if (sessionIdRef.current) {
        void syncSessionHistory(sessionIdRef.current);
      }
    });

    // Always pull on focus so an already-subscribed, currently-streaming workspace
    // delivers its consolidated stream_snapshot on first navigation (the in-flight
    // catch-up case). With a saved session → focus it; without → bare
    // switch_session so the backend resolves the active session. Replace semantics
    // make a redundant pull harmless.
    wsTransport.send(workspaceId, {
      type: "switch_session",
      ...sessionIdField(savedSession),
    });

    // REST history is the single source of truth — always fetch on focus, EXCEPT
    // when the transport just replayed buffered live events into state during the
    // onMessage() registration above. Those replayed turns (e.g. a finalized
    // `done`, on top of the cache prefill) are newer than any disk snapshot this
    // fetch could read, and a replayed done/cancelled already triggers
    // syncSessionHistory() to reconcile authoritatively — so a mount fetch here
    // could only clobber the fresher replayed state. (Defense in depth: the
    // buffer is currently drained by the App-root live-data handler, but this
    // keeps the invariant from depending on that wiring.)
    const mountSeq = fetchSeqRef.current;
    if (!hadBufferedMessages) {
      const mountReplaceSeq = ++replaceHistorySeqRef.current;
      void (async () => {
        try {
          const url = savedSession
            ? `/api/workspaces/${workspaceId}/sessions/${savedSession}/messages?limit=${HISTORY_LIMIT}`
            : `/api/workspaces/${workspaceId}/session/messages?limit=${HISTORY_LIMIT}`;
          const res = await api.get<SessionMessagesResponse>(url);
          // Drop if the user has since sent a message / switched session (the
          // optimistic/live state is newer than this initial-load response).
          if (fetchSeqRef.current !== mountSeq) return;
          if (replaceHistorySeqRef.current !== mountReplaceSeq) return;
          if (sessionIdRef.current && savedSession && sessionIdRef.current !== savedSession) return;
          dispatch({ type: "set_history", sessionId: savedSession, messages: res.messages, hasMore: res.hasMore });
        } catch {
          // History is best-effort; WS live state still drives the in-flight turn.
        }
      })();
    }

    return () => {
      // Remember which session was active before leaving this workspace.
      if (workspaceId && sessionIdRef.current) {
        savedSessionByWorkspace.set(workspaceId, sessionIdRef.current);
      }
      flushDeltas();
      deltaBufferRef.current = new Map();
      unsubscribe();
      unsubReconnect();
    };
  }, [workspaceId, syncSessionHistory, bufferDelta, flushDeltas]);

  // Keep the transport's per-session window cache fresh so switch-back is
  // instant (stale-while-revalidate). Fires when messages/hasMore change — NOT
  // on streaming deltas. Guard: skip writes when workspaceId just changed so a
  // transient render holding the previous workspace's messages (React batching)
  // doesn't pollute the new workspace's cache.
  const prevCacheWorkspaceRef = useRef(workspaceId);
  useEffect(() => {
    if (prevCacheWorkspaceRef.current !== workspaceId) {
      prevCacheWorkspaceRef.current = workspaceId;
      return;
    }
    if (!workspaceId || !state.sessionId || state.messages.length === 0) return;
    wsTransport.setSessionWindow(workspaceId, state.sessionId, {
      messages: state.messages,
      hasMore: state.hasMore,
    });
  }, [workspaceId, state.sessionId, state.messages, state.hasMore]);

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
    // Invalidate any in-flight initial history fetch so it can't clobber the
    // optimistic turn this send is about to produce.
    fetchSeqRef.current += 1;
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
    // Supersede any in-flight initial history fetch for the previous session.
    fetchSeqRef.current += 1;
    dispatch({ type: "prepare_session_switch", sessionId });
    dispatch({ type: "status", status: "busy", sessionId, streaming: false });

    // Stale-while-revalidate from the per-session window cache.
    const cached = wsTransport.getSessionWindow(workspaceId, sessionId);
    if (cached) {
      dispatch({ type: "set_history", sessionId, messages: cached.messages, hasMore: cached.hasMore });
    }

    const sent = wsTransport.send(workspaceId, { type: "switch_session", sessionId });
    if (!sent) {
      dispatch({ type: "error", message: "Session switch failed: disconnected from server." });
    }
    void syncSessionHistory(sessionId);
  }, [workspaceId, syncSessionHistory]);

  /** Load an older window and prepend it (explicit "Load earlier messages"). */
  const loadEarlier = useCallback(async () => {
    if (!workspaceId) return;
    const sessionId = sessionIdRef.current;
    const oldest = state.messages[0];
    if (!sessionId || !oldest || !state.hasMore) return;
    try {
      const res = await api.get<SessionMessagesResponse>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/messages?limit=${HISTORY_LIMIT}&before=${encodeURIComponent(oldest.id)}`,
      );
      if (sessionIdRef.current !== sessionId) return;
      dispatch({ type: "prepend_history", sessionId, beforeId: oldest.id, messages: res.messages, hasMore: res.hasMore });
    } catch {
      // Best-effort; the button stays available for a retry.
    }
  }, [workspaceId, state.messages, state.hasMore]);

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
    messages: state.messages,
    hasMore: state.hasMore,
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
    loadEarlier,
    answerQuestion,
    batchAnswerQuestions,
    approvePlan,
    rejectToolInput,
    dismissPlan,
  };
}
