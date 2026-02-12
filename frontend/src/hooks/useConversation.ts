import { useEffect, useCallback, useReducer, useSyncExternalStore } from "react";
import type { ChatMessage, ToolCall, WsOutgoing, QuestionAnswer } from "@/types";
import { wsTransport } from "@/lib/ws-transport";

interface ConversationState {
  messages: ChatMessage[];
  isStreaming: boolean;
  workspaceStatus?: "idle" | "busy";
  currentText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  error?: string;
  sessionId?: string;
}

type LocalAction =
  | { type: "add_user_message"; content: string }
  | { type: "reset" }
  | { type: "clear_chat" };

type Action = WsOutgoing | LocalAction;

const initialState: ConversationState = {
  messages: [],
  isStreaming: false,
  workspaceStatus: undefined,
  currentText: "",
  currentThinking: "",
  activeToolCalls: [],
  error: undefined,
  sessionId: undefined,
};

function reducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case "add_user_message":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: crypto.randomUUID(),
            sessionId: state.sessionId ?? "",
            role: "user",
            content: action.content,
            timestamp: new Date().toISOString(),
          },
        ],
        isStreaming: true,
        currentText: "",
        currentThinking: "",
        activeToolCalls: [],
        error: undefined,
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
          { id: action.id, name: action.name, input: action.input },
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
      return { ...state, messages: action.messages };

    case "clear_chat":
      return {
        ...state,
        messages: [],
        isStreaming: false,
        currentText: "",
        currentThinking: "",
        activeToolCalls: [],
        error: undefined,
        sessionId: undefined,
      };

    case "reset":
      return initialState;
  }
}

export function useConversation(workspaceId: string | undefined) {
  const [state, dispatch] = useReducer(reducer, initialState);
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
    dispatch({ type: "reset" });
    wsTransport.connect(workspaceId);

    const unsubMessage = wsTransport.onMessage(workspaceId, (msg) => dispatch(msg));

    return () => {
      unsubMessage();
    };
  }, [workspaceId]);

  const sendMessage = useCallback((content: string): boolean => {
    if (!workspaceId) {
      dispatch({ type: "error", message: "Message not sent: no workspace selected." });
      return false;
    }
    const sent = wsTransport.send(workspaceId, { type: "user_message", content });
    if (!sent) {
      dispatch({ type: "error", message: "Message not sent: disconnected from server." });
      return false;
    }
    dispatch({ type: "add_user_message", content });
    return true;
  }, [workspaceId]);

  const stopStreaming = useCallback(() => {
    if (!workspaceId) return;
    wsTransport.send(workspaceId, { type: "stop" });
  }, [workspaceId]);

  const clearChat = useCallback(() => {
    dispatch({ type: "clear_chat" });
  }, []);

  const answerQuestion = useCallback((_toolCallId: string, answers: QuestionAnswer[]) => {
    const formatted = answers.map((a) => {
      if (a.customText) return `Q${a.questionIndex + 1}: "${a.customText}"`;
      return `Q${a.questionIndex + 1}: Selected option(s) ${a.selectedOptions.map((i) => i + 1).join(", ")}`;
    }).join("\n");
    sendMessage(`[Response to question]\n${formatted}`);
  }, [sendMessage]);

  const approvePlan = useCallback(() => {
    sendMessage("I approve the plan. Please proceed with implementation.");
  }, [sendMessage]);

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    workspaceStatus: state.workspaceStatus,
    currentStreamingText: state.currentText,
    currentThinking: state.currentThinking,
    activeToolCalls: state.activeToolCalls,
    connectionStatus,
    error: state.error,
    sessionId: state.sessionId,
    sendMessage,
    stopStreaming,
    clearChat,
    answerQuestion,
    approvePlan,
  };
}
