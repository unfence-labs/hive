export interface Project {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  workspaces: Workspace[];
}

export interface Workspace {
  id: string;
  name: string;
  branch: string;
  status: "running" | "idle" | "in_session";
  createdAt: string;
  agents: Agent[];
}

export interface Agent {
  id: string;
  prompt: string;
  status: "running" | "streaming" | "done" | "error";
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
  outputFile?: string;
}

export interface CreateProjectRequest {
  url: string;
}

export interface CreateAgentRequest {
  prompt: string;
  mode?: "conversation" | "print";
  sessionId?: string;
}

export interface WsMessage {
  type: "stdout" | "stderr" | "status" | "exit";
  data?: string;
  code?: number;
  ts: number;
}

// ── Conversation protocol types ──────────────────────────────────────

export interface ToolUseBlock {
  id: string;
  name: string;
  input: string;
  result?: string;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  toolUse?: ToolUseBlock[];
  timestamp: string;
}

export type WsIncoming =
  | { type: "user_message"; content: string }
  | { type: "stop" };

export type WsOutgoing =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; input: string }
  | { type: "tool_use_end"; id: string; result?: string }
  | { type: "message_end" }
  | { type: "error"; message: string }
  | { type: "status"; status: string };

export interface ConversationUIState {
  messages: ConversationMessage[];
  isStreaming: boolean;
  currentText: string;
  error?: string;
}
