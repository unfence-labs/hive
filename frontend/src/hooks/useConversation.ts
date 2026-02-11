import { useEffect, useRef, useCallback, useReducer } from "react";
import type { ChatMessage, ToolCall, WsOutgoing } from "@/types";

interface ConversationState {
  messages: ChatMessage[];
  isStreaming: boolean;
  workspaceStatus?: "idle" | "busy";
  currentText: string;
  currentThinking: string;
  activeToolCalls: ToolCall[];
  connectionStatus: "connecting" | "connected" | "disconnected";
  error?: string;
  sessionId?: string;
}

type Action =
  | { type: "add_user_message"; content: string }
  | { type: "text_delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; output: string }
  | { type: "done"; sessionId?: string }
  | { type: "cancelled" }
  | { type: "error"; message: string }
  | { type: "status"; status: "idle" | "busy"; sessionId?: string; streaming?: boolean }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "set_connection"; status: ConversationState["connectionStatus"] }
  | { type: "reset" };

const initialState: ConversationState = {
  messages: [],
  isStreaming: false,
  workspaceStatus: undefined,
  currentText: "",
  currentThinking: "",
  activeToolCalls: [],
  connectionStatus: "disconnected",
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

    case "set_connection":
      return { ...state, connectionStatus: action.status };

    case "reset":
      return initialState;
  }
}

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;

export function useConversation(workspaceId: string | undefined) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!workspaceId || !mountedRef.current) return;

    dispatch({ type: "set_connection", status: "connecting" });

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsHost = import.meta.env.VITE_WS_URL || `${protocol}//${window.location.host}`;
    const ws = new WebSocket(
      `${wsHost}/ws/session/${workspaceId}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      dispatch({ type: "set_connection", status: "connected" });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsOutgoing;
        switch (msg.type) {
          case "text_delta":
            dispatch({ type: "text_delta", text: msg.text });
            break;
          case "thinking":
            dispatch({ type: "thinking", text: msg.text });
            break;
          case "tool_use":
            dispatch({ type: "tool_use", id: msg.id, name: msg.name, input: msg.input });
            break;
          case "tool_result":
            dispatch({ type: "tool_result", toolUseId: msg.toolUseId, output: msg.output });
            break;
          case "done":
            dispatch({ type: "done", sessionId: msg.sessionId });
            break;
          case "cancelled":
            dispatch({ type: "cancelled" });
            break;
          case "error":
            dispatch({ type: "error", message: msg.message });
            break;
          case "status":
            dispatch({ type: "status", status: msg.status, sessionId: msg.sessionId });
            break;
          case "history":
            dispatch({ type: "history", messages: msg.messages });
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      dispatch({ type: "set_connection", status: "disconnected" });
      if (!mountedRef.current) return;

      // Exponential backoff reconnect
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** attempt, MAX_RECONNECT_DELAY);
      reconnectTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }, [workspaceId]);

  useEffect(() => {
    mountedRef.current = true;
    dispatch({ type: "reset" });
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    dispatch({ type: "add_user_message", content });
    wsRef.current.send(JSON.stringify({ type: "user_message", content }));
  }, []);

  const stopStreaming = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "stop" }));
  }, []);

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    workspaceStatus: state.workspaceStatus,
    currentStreamingText: state.currentText,
    currentThinking: state.currentThinking,
    activeToolCalls: state.activeToolCalls,
    connectionStatus: state.connectionStatus,
    error: state.error,
    sessionId: state.sessionId,
    sendMessage,
    stopStreaming,
  };
}
