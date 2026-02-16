import { useEffect, useCallback, useReducer, useRef, useSyncExternalStore } from "react";
import type { ChatMessage, ImageAttachment, MessageOptions, ToolCall, WsOutgoing, QuestionAnswer, QuestionInput } from "@/types";
import { wsTransport } from "@/lib/ws-transport";
import { api } from "@/hooks/useApi";

export interface PendingToolInput {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: unknown;
}

interface ConversationState {
  messages: ChatMessage[];
  isStreaming: boolean;
  workspaceStatus?: "idle" | "busy";
  currentText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  pendingToolInputs: PendingToolInput[];
  error?: string;
  sessionId?: string;
}

const CANCELLED_NO_OUTPUT_MESSAGE = "Generation interrupted before any output.";

type LocalAction =
  | { type: "reset" }
  | { type: "clear_chat" }
  | { type: "prepare_session_switch"; sessionId: string }
  | { type: "clear_pending_tool_inputs" };

type Action = WsOutgoing | LocalAction;

const initialState: ConversationState = {
  messages: [],
  isStreaming: false,
  workspaceStatus: undefined,
  currentText: "",
  currentThinking: "",
  activeToolCalls: [],
  pendingToolInputs: [],
  error: undefined,
  sessionId: undefined,
};

function parseToolInput(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return {};
  }
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

function getActionSessionId(action: Action): string | undefined {
  switch (action.type) {
    case "user_message":
      return action.message.sessionId;
    case "text_delta":
    case "thinking":
    case "tool_use":
    case "tool_result":
    case "tool_input_required":
    case "done":
    case "cancelled":
    case "status":
      return action.sessionId;
    case "history":
      return action.sessionId ?? action.messages[0]?.sessionId;
    default:
      return undefined;
  }
}

function reducer(state: ConversationState, action: Action): ConversationState {
  if (
    action.type !== "reset" &&
    action.type !== "clear_chat" &&
    action.type !== "clear_pending_tool_inputs" &&
    action.type !== "prepare_session_switch"
  ) {
    const actionSessionId = getActionSessionId(action);
    if (actionSessionId && state.sessionId && actionSessionId !== state.sessionId) {
      return state;
    }
  }

  switch (action.type) {
    case "user_message":
      if (state.messages.some((message) => message.id === action.message.id)) {
        return state;
      }
      return {
        ...state,
        messages: [...state.messages, action.message],
        isStreaming: true,
        currentText: "",
        currentThinking: "",
        activeToolCalls: [],
        pendingToolInputs: [],
        error: undefined,
        sessionId: action.message.sessionId || state.sessionId,
      };

    case "text_delta":
      return { ...state, currentText: state.currentText + action.text };

    case "thinking":
      return { ...state, currentThinking: state.currentThinking + action.text };

    case "tool_use":
      return {
        ...state,
        activeToolCalls: [
          ...state.activeToolCalls,
          { id: action.id, name: action.name, input: action.input, parentToolUseId: action.parentToolUseId },
        ],
      };

    case "tool_result": {
      const tools = state.activeToolCalls.map((t) =>
        t.id === action.toolUseId ? { ...t, output: action.output } : t,
      );
      return { ...state, activeToolCalls: tools };
    }

    case "done": {
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: action.sessionId,
        role: "assistant",
        content: state.currentText,
        toolCalls: state.activeToolCalls.length > 0 ? state.activeToolCalls : undefined,
        thinkingContent: state.currentThinking || undefined,
        timestamp: new Date().toISOString(),
        durationMs: action.durationMs,
      };
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        isStreaming: false,
        currentText: "",
        currentThinking: "",
        activeToolCalls: [],
        sessionId: action.sessionId,
      };
    }

    case "cancelled": {
      const hasOutput = state.currentText.length > 0 || state.activeToolCalls.length > 0;
      const hasThinking = state.currentThinking.length > 0;
      // Ignore stale cancelled events from a previous session after a fast switch.
      if (!state.isStreaming && !hasOutput && !hasThinking) {
        return state;
      }
      const cancelledMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: action.sessionId,
        role: "assistant",
        content: hasOutput ? state.currentText : CANCELLED_NO_OUTPUT_MESSAGE,
        toolCalls: state.activeToolCalls.length > 0 ? state.activeToolCalls : undefined,
        thinkingContent: state.currentThinking || undefined,
        timestamp: new Date().toISOString(),
        cancelled: true,
      };
      return {
        ...state,
        messages: [...state.messages, cancelledMsg],
        isStreaming: false,
        currentText: "",
        currentThinking: "",
        activeToolCalls: [],
      };
    }

    case "error":
      return { ...state, error: action.message, isStreaming: false };

    case "status":
      return {
        ...state,
        workspaceStatus: action.status,
        sessionId: action.sessionId ?? (action.status === "idle" ? undefined : state.sessionId),
        isStreaming: action.streaming ?? (action.status === "idle" ? false : state.isStreaming),
      };

    case "history": {
      const historySessionId = action.sessionId ?? action.messages[0]?.sessionId ?? state.sessionId;
      const preserveTransient = Boolean(
        historySessionId &&
        state.sessionId === historySessionId &&
        state.isStreaming,
      );
      const hydratedPendingToolInputs = preserveTransient
        ? state.pendingToolInputs
        : derivePendingToolInputsFromHistory(action.messages);
      return {
        ...state,
        messages: action.messages,
        isStreaming: preserveTransient ? state.isStreaming : false,
        currentText: preserveTransient ? state.currentText : "",
        currentThinking: preserveTransient ? state.currentThinking : "",
        activeToolCalls: preserveTransient ? state.activeToolCalls : [],
        pendingToolInputs: hydratedPendingToolInputs,
        error: undefined,
        sessionId: historySessionId,
      };
    }

    case "tool_input_required":
      return {
        ...state,
        pendingToolInputs: [...state.pendingToolInputs, {
          requestId: action.requestId,
          toolName: action.toolName,
          toolUseId: action.toolUseId,
          input: action.input,
        }],
      };

    case "clear_pending_tool_inputs":
      return { ...state, pendingToolInputs: [] };

    case "prepare_session_switch":
      return {
        ...state,
        sessionId: action.sessionId,
        isStreaming: false,
        currentText: "",
        currentThinking: "",
        activeToolCalls: [],
        pendingToolInputs: [],
        error: undefined,
      };

    case "clear_chat":
      return {
        ...state,
        messages: [],
        isStreaming: false,
        currentText: "",
        currentThinking: "",
        activeToolCalls: [],
        pendingToolInputs: [],
        error: undefined,
        sessionId: undefined,
      };

    case "reset":
      return initialState;

    default:
      return state;
  }
}

export function useConversation(workspaceId: string | undefined) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const historyRequestTokenRef = useRef(0);
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
    const historyRequestToken = historyRequestTokenRef.current + 1;
    historyRequestTokenRef.current = historyRequestToken;

    dispatch({ type: "reset" });
    wsTransport.connect(workspaceId);

    const { unsubscribe, hadBufferedMessages } = wsTransport.onMessage(workspaceId, (msg) => {
      dispatch(msg);
      if ((msg.type === "done" || msg.type === "cancelled") && msg.sessionId) {
        void syncSessionHistory(msg.sessionId);
      }
    });

    // If the transport replayed buffered messages (events that arrived while we were
    // on another workspace), the reducer already has the most current state. Bump the
    // token so the async REST fetch won't overwrite it with potentially stale disk data.
    if (hadBufferedMessages) {
      historyRequestTokenRef.current += 1;
    }

    void (async () => {
      try {
        const messages = await api.get<ChatMessage[]>(`/api/workspaces/${workspaceId}/session/messages`);
        if (historyRequestTokenRef.current !== historyRequestToken) return;
        dispatch({ type: "history", messages });
      } catch {
        // History is still best-effort via websocket replay if API fetch fails.
      }
    })();

    return () => {
      if (historyRequestTokenRef.current === historyRequestToken) {
        historyRequestTokenRef.current = historyRequestToken + 1;
      }
      unsubscribe();
    };
  }, [workspaceId, syncSessionHistory]);

  const sendMessage = useCallback((content: string, images?: ImageAttachment[], options?: MessageOptions): boolean => {
    if (!workspaceId) {
      dispatch({ type: "error", message: "Message not sent: no workspace selected." });
      return false;
    }
    const sent = wsTransport.send(workspaceId, {
      type: "user_message",
      content,
      images: images?.length ? images : undefined,
      options,
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
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
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    });
  }, [workspaceId, state.sessionId]);

  const clearChat = useCallback(() => {
    dispatch({ type: "clear_chat" });
  }, []);

  const switchSession = useCallback(async (sessionId: string) => {
    if (!workspaceId) return;
    dispatch({ type: "prepare_session_switch", sessionId });
    dispatch({ type: "status", status: "busy", sessionId, streaming: false });
    historyRequestTokenRef.current += 1;
    const sent = wsTransport.send(workspaceId, { type: "switch_session", sessionId });
    if (!sent) {
      dispatch({ type: "error", message: "Session switch failed: disconnected from server." });
    }
  }, [workspaceId]);

  const answerQuestion = useCallback((toolCallId: string, answers: QuestionAnswer[]) => {
    if (!workspaceId) return;
    const pending = state.pendingToolInputs.find((p) => p.toolUseId === toolCallId);
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending?.requestId ?? toolCallId,
      toolName: "AskUserQuestion",
      result: { type: "answer", answers },
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    });
    dispatch({ type: "clear_pending_tool_inputs" });
    historyRequestTokenRef.current += 1;
  }, [workspaceId, state.pendingToolInputs, state.sessionId]);

  const batchAnswerQuestions = useCallback(
    (responses: Array<{ toolUseId: string; answers: QuestionAnswer[] }>) => {
      if (!workspaceId) return;
      for (const { toolUseId, answers } of responses) {
        const pending = state.pendingToolInputs.find((p) => p.toolUseId === toolUseId);
        const input = pending?.input as { questions?: QuestionInput[] } | undefined;
        wsTransport.send(workspaceId, {
          type: "tool_input_response",
          requestId: pending?.requestId ?? toolUseId,
          toolName: "AskUserQuestion",
          result: { type: "answer", answers, questions: input?.questions },
          ...(state.sessionId ? { sessionId: state.sessionId } : {}),
        });
      }
      dispatch({ type: "clear_pending_tool_inputs" });
      historyRequestTokenRef.current += 1;
    },
    [workspaceId, state.pendingToolInputs, state.sessionId],
  );

  const approvePlan = useCallback(() => {
    if (!workspaceId) return;
    const pending = state.pendingToolInputs.find((p) => p.toolName === "ExitPlanMode");
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending?.requestId ?? "",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    });
    dispatch({ type: "clear_pending_tool_inputs" });
    historyRequestTokenRef.current += 1;
  }, [workspaceId, state.pendingToolInputs, state.sessionId]);

  const rejectToolInput = useCallback((message?: string) => {
    if (!workspaceId || state.pendingToolInputs.length === 0) return;
    const pending = state.pendingToolInputs[0];
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending.requestId,
      toolName: pending.toolName,
      result: { type: "reject", message },
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    });
    dispatch({ type: "clear_pending_tool_inputs" });
    historyRequestTokenRef.current += 1;
  }, [workspaceId, state.pendingToolInputs, state.sessionId]);

  const dismissPlan = useCallback((message?: string) => {
    if (!workspaceId) return;
    const pending = state.pendingToolInputs.find((p) => p.toolName === "ExitPlanMode");
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending?.requestId ?? "",
      toolName: "ExitPlanMode",
      result: { type: "dismiss", message },
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    });
    if (pending) {
      dispatch({ type: "clear_pending_tool_inputs" });
    }
    historyRequestTokenRef.current += 1;
  }, [workspaceId, state.pendingToolInputs, state.sessionId]);

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    workspaceStatus: state.workspaceStatus,
    currentStreamingText: state.currentText,
    currentThinking: state.currentThinking,
    activeToolCalls: state.activeToolCalls,
    pendingToolInputs: state.pendingToolInputs,
    connectionStatus,
    error: state.error,
    sessionId: state.sessionId,
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
