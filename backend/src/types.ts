export interface Project {
  id: string;
  name: string;
  url: string;
  createdAt: string;
}

export type WorkspaceStatus = "idle" | "busy";

export interface Workspace {
  id: string;
  name: string;
  projectId: string;
  branch: string;
  status: WorkspaceStatus;
  createdAt: string;
  activeSessionId?: string;
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

// ── Session / Chat types ────────────────────────────────────────────

export interface SessionMetadata {
  sessionId: string;
  claudeSessionId?: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  thinkingContent?: string;
  timestamp: string;
  cancelled?: boolean;
}

// ── Claude CLI NDJSON types (--print --output-format stream-json --verbose) ──

/** Content block within an assistant message */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "thinking"; thinking: string };

/** Tool result block within a user message */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type CliJsonLine =
  | {
      type: "assistant";
      message: {
        id: string;
        role: "assistant";
        content: ContentBlock[];
        model?: string;
        stop_reason?: string;
      };
    }
  | {
      type: "user";
      message: {
        role: "user";
        content: ToolResultBlock[];
      };
    }
  | {
      type: "result";
      session_id: string;
      cost_usd?: number;
      duration_ms?: number;
      usage?: { input_tokens: number; output_tokens: number };
    }
  | {
      type: "system";
      message: string;
      level?: string;
    };

// ── WebSocket protocol ──────────────────────────────────────────────

/** Frontend -> Backend */
export type WsIncoming =
  | { type: "user_message"; content: string }
  | { type: "stop" };

/** Backend -> Frontend */
export type WsOutgoing =
  | { type: "text_delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; output: string }
  | { type: "done"; sessionId?: string; costUsd?: number }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "status"; status: WorkspaceStatus; sessionId?: string; streaming?: boolean }
  | { type: "history"; messages: ChatMessage[] };
