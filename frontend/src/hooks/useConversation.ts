import { useEffect, useCallback, useReducer, useRef, useSyncExternalStore } from "react";
import type { ChatMessage, MessageOptions, ToolCall, WsOutgoing, QuestionAnswer, QuestionInput } from "@/types";
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

type LocalAction =
  | { type: "reset" }
  | { type: "clear_chat" }
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

function reducer(state: ConversationState, action: Action): ConversationState {
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
        sessionId: action.sessionId ?? state.sessionId ?? "",
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
        sessionId: action.sessionId ?? state.sessionId,
      };
    }

    case "cancelled": {
      const cancelledMsg: ChatMessage = {
        id: crypto.randomUUID(),
        sessionId: state.sessionId ?? "",
        role: "assistant",
        content: state.currentText,
        toolCalls: state.activeToolCalls.length > 0 ? state.activeToolCalls : undefined,
        thinkingContent: state.currentThinking || undefined,
        timestamp: new Date().toISOString(),
        cancelled: true,
      };
      return {
        ...state,
        messages: state.currentText || state.activeToolCalls.length > 0
          ? [...state.messages, cancelledMsg]
          : state.messages,
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
        sessionId: action.sessionId ?? state.sessionId,
        isStreaming: action.streaming ?? (action.status === "idle" ? false : state.isStreaming),
      };

    case "history":
      return {
        ...state,
        messages: action.messages,
        sessionId: action.messages[0]?.sessionId ?? state.sessionId,
      };

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
  }
}

export function useConversation(workspaceId: string | undefined) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const historyRequestTokenRef = useRef(0);
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

    const { unsubscribe, hadBufferedMessages } = wsTransport.onMessage(workspaceId, (msg) => dispatch(msg));

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
  }, [workspaceId]);

  const sendMessage = useCallback((content: string, options?: MessageOptions): boolean => {
    if (!workspaceId) {
      dispatch({ type: "error", message: "Message not sent: no workspace selected." });
      return false;
    }
    const sent = wsTransport.send(workspaceId, { type: "user_message", content, options });
    if (!sent) {
      dispatch({ type: "error", message: "Message not sent: disconnected from server." });
      return false;
    }
    historyRequestTokenRef.current += 1;
    return true;
  }, [workspaceId]);

  const stopStreaming = useCallback(() => {
    if (!workspaceId) return;
    wsTransport.send(workspaceId, { type: "stop" });
  }, [workspaceId]);

  const clearChat = useCallback(() => {
    dispatch({ type: "clear_chat" });
  }, []);

  const switchSession = useCallback(async (sessionId: string) => {
    if (!workspaceId) return;
    dispatch({ type: "clear_chat" });
    dispatch({ type: "status", status: "busy", sessionId, streaming: false });
    historyRequestTokenRef.current += 1;
    const token = historyRequestTokenRef.current;
    try {
      const messages = await api.get<ChatMessage[]>(
        `/api/workspaces/${workspaceId}/sessions/${sessionId}/messages`,
      );
      if (historyRequestTokenRef.current !== token) return;
      dispatch({ type: "history", messages });
    } catch {
      // Non-fatal — chat will be empty until next WS event
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
    });
    dispatch({ type: "clear_pending_tool_inputs" });
    historyRequestTokenRef.current += 1;
  }, [workspaceId, state.pendingToolInputs]);

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
        });
      }
      dispatch({ type: "clear_pending_tool_inputs" });
      historyRequestTokenRef.current += 1;
    },
    [workspaceId, state.pendingToolInputs],
  );

  const approvePlan = useCallback(() => {
    if (!workspaceId) return;
    const pending = state.pendingToolInputs.find((p) => p.toolName === "ExitPlanMode");
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending?.requestId ?? "",
      toolName: "ExitPlanMode",
      result: { type: "approve" },
    });
    dispatch({ type: "clear_pending_tool_inputs" });
    historyRequestTokenRef.current += 1;
  }, [workspaceId, state.pendingToolInputs]);

  const rejectToolInput = useCallback((message?: string) => {
    if (!workspaceId || state.pendingToolInputs.length === 0) return;
    const pending = state.pendingToolInputs[0];
    wsTransport.send(workspaceId, {
      type: "tool_input_response",
      requestId: pending.requestId,
      toolName: pending.toolName,
      result: { type: "reject", message },
    });
    dispatch({ type: "clear_pending_tool_inputs" });
    historyRequestTokenRef.current += 1;
  }, [workspaceId, state.pendingToolInputs]);

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
  };
}
