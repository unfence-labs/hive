export interface Project {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

export type WorkspaceStatus = "idle" | "running" | "in_session";

export interface Workspace {
  id: string;
  name: string;
  projectId: string;
  branch: string;
  status: WorkspaceStatus;
  createdAt: string;
  agents: Agent[];
}

export type AgentStatus = "running" | "streaming" | "done" | "error";

export interface Agent {
  id: string;
  workspaceId: string;
  prompt: string;
  status: AgentStatus;
  exitCode?: number;
  startedAt: string;
  finishedAt?: string;
  outputFile: string;
}

export interface ProjectState {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  workspaces: Workspace[];
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

export interface ConversationState {
  sessionId: string;
  messages: ConversationMessage[];
  status: "idle" | "streaming" | "error";
}

// Claude CLI stream-json event types (--output-format stream-json --include-partial-messages)
export type StreamEvent =
  | { type: "message_start"; message: { id: string; role: string } }
  | { type: "content_block_start"; index: number; content_block: { type: "text" } | { type: "tool_use"; id: string; name: string } }
  | { type: "content_block_delta"; index: number; delta: TextDelta | InputJsonDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason: string } }
  | { type: "message_stop" };

export interface TextDelta {
  type: "text_delta";
  text: string;
}

export interface InputJsonDelta {
  type: "input_json_delta";
  partial_json: string;
}

// Raw NDJSON line from Claude CLI
export type CliJsonLine =
  | { type: "stream_event"; event: StreamEvent }
  | { type: "result"; result: { type: string }; session_id: string; cost_usd?: number }
  | { type: "assistant_message"; message: unknown };

// WebSocket messages: frontend → backend
export type WsIncoming =
  | { type: "user_message"; content: string }
  | { type: "stop" };

// WebSocket messages: backend → frontend
export type WsOutgoing =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; input: string }
  | { type: "tool_use_end"; id: string; result?: string }
  | { type: "message_end" }
  | { type: "error"; message: string }
  | { type: "status"; status: string };

export interface CreateConversationRequest {
  sessionId?: string;
}
