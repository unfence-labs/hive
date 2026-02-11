import { useEffect, useRef, useCallback, useReducer } from "react";
import type { ConversationMessage, ToolUseBlock, WsOutgoing } from "@/types";
import { useConversationApi } from "@/hooks/useConversationApi";

interface ConversationState {
  messages: ConversationMessage[];
  isStreaming: boolean;
  currentText: string;
  currentToolUse: ToolUseBlock[];
  error?: string;
}

type Action =
  | { type: "add_user_message"; content: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; input: string }
  | { type: "tool_use_end"; id: string; result?: string }
  | { type: "message_end" }
  | { type: "error"; message: string }
  | { type: "set_streaming"; value: boolean }
  | { type: "load_messages"; messages: ConversationMessage[] }
  | { type: "reset" };

const initialState: ConversationState = {
  messages: [],
  isStreaming: false,
  currentText: "",
  currentToolUse: [],
  error: undefined,
};

function reducer(state: ConversationState, action: Action): ConversationState {
  switch (action.type) {
    case "add_user_message":
      return {
        ...state,
        messages: [
          ...state.messages,
          { role: "user", content: action.content, timestamp: new Date().toISOString() },
        ],
        isStreaming: true,
        currentText: "",
        currentToolUse: [],
        error: undefined,
      };

    case "text_delta":
      return { ...state, currentText: state.currentText + action.text };

    case "tool_use_start":
      return {
        ...state,
        currentToolUse: [
          ...state.currentToolUse,
          { id: action.id, name: action.name, input: "" },
        ],
      };

    case "tool_use_delta": {
      const tools = state.currentToolUse.map((t) =>
        t.id === action.id ? { ...t, input: t.input + action.input } : t,
      );
      return { ...state, currentToolUse: tools };
    }

    case "tool_use_end": {
      const tools = state.currentToolUse.map((t) =>
        t.id === action.id ? { ...t, result: action.result } : t,
      );
      return { ...state, currentToolUse: tools };
    }

    case "message_end": {
      const assistantMsg: ConversationMessage = {
        role: "assistant",
        content: state.currentText,
        toolUse: state.currentToolUse.length > 0 ? state.currentToolUse : undefined,
        timestamp: new Date().toISOString(),
      };
      return {
        ...state,
        messages: [...state.messages, assistantMsg],
        isStreaming: false,
        currentText: "",
        currentToolUse: [],
      };
    }

    case "error":
      return { ...state, error: action.message, isStreaming: false };

    case "set_streaming":
      return { ...state, isStreaming: action.value };

    case "load_messages":
      return { ...state, messages: action.messages };

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
  const { getMessages } = useConversationApi(workspaceId);

  const connect = useCallback(() => {
    if (!workspaceId || !mountedRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/conversation/${workspaceId}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsOutgoing;
        switch (msg.type) {
          case "text_delta":
            dispatch({ type: "text_delta", text: msg.text });
            break;
          case "tool_use_start":
            dispatch({ type: "tool_use_start", id: msg.id, name: msg.name });
            break;
          case "tool_use_delta":
            dispatch({ type: "tool_use_delta", id: msg.id, input: msg.input });
            break;
          case "tool_use_end":
            dispatch({ type: "tool_use_end", id: msg.id, result: msg.result });
            break;
          case "message_end":
            dispatch({ type: "message_end" });
            break;
          case "error":
            dispatch({ type: "error", message: msg.message });
            break;
          case "status":
            // Could track connection status if needed
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      if (!mountedRef.current) return;

      // Exponential backoff reconnect
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(BASE_RECONNECT_DELAY * 2 ** attempt, MAX_RECONNECT_DELAY);
      reconnectTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        // Reload message history on reconnect
        try {
          const messages = await getMessages();
          dispatch({ type: "load_messages", messages });
        } catch {
          // API may not be ready yet — will retry on next reconnect
        }
        connect();
      }, delay);
    };

    ws.onerror = () => {
      // onclose will fire after this, triggering reconnect
    };
  }, [workspaceId, getMessages]);

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
    currentStreamingText: state.currentText,
    currentToolUse: state.currentToolUse,
    error: state.error,
    sendMessage,
    stopStreaming,
  };
}
