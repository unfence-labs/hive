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

// ── Completion / autocomplete types ─────────────────────────────────

export type CompletionItemType = "slash_command" | "agent";
export type CompletionSource =
  | "builtin"
  | "user_skill"
  | "project_skill"
  | "plugin"
  | "user_agent"
  | "project_agent";

export interface CompletionItem {
  type: CompletionItemType;
  name: string;
  label: string;
  description?: string;
  argumentHint?: string;
  source: CompletionSource;
}

export interface CompletionsResponse {
  items: CompletionItem[];
}

// ── Branch / GitHub sync types ──────────────────────────────────────

export interface PullRequestInfo {
  number: number;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  mergeable: boolean | null;
  mergeableState: "clean" | "conflict" | "unstable" | "unknown";
  checksStatus: "pending" | "success" | "failure";
}

export interface BranchInfo {
  name: string;
  lastSyncedAt: string;
}

export interface PrStatusResponse {
  pr: PullRequestInfo | null;
  error?: string;
}

export interface WorkspaceFileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceFileTreeNode[];
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

// ── Image attachment type ────────────────────────────────────────────

export interface ImageAttachment {
  name: string;
  mediaType: string;
  dataUrl: string;
}

// ── Session / Chat types ────────────────────────────────────────────

export interface SessionMetadata {
  sessionId: string;
  claudeSessionId?: string;
  workspaceId: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** Provider ID locked on first message (e.g. "claude" or "codex"). */
  lockedProvider?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: string;
  output?: string;
  parentToolUseId?: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  images?: ImageAttachment[];
  toolCalls?: ToolCall[];
  thinkingContent?: string;
  timestamp: string;
  cancelled?: boolean;
  durationMs?: number;
}

// ── Claude CLI NDJSON types (--print --output-format stream-json --verbose) ──

/** Content block within an assistant message */
export type ServerToolResultType =
  | "web_search_tool_result"
  | "web_fetch_tool_result"
  | "bash_code_execution_tool_result"
  | "text_editor_code_execution_tool_result";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "server_tool_use"; id: string; name: string; input: unknown }
  | { type: "mcp_tool_use"; id: string; name: string; server_name: string; input: unknown }
  | { type: ServerToolResultType; tool_use_id: string; content: unknown }
  | { type: "mcp_tool_result"; tool_use_id: string; is_error: boolean; content: unknown }
  | { type: "thinking"; thinking: string }
  | { type: "redacted_thinking"; data: string };

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

// ── Script types ─────────────────────────────────────────────────────

export type ScriptType = string;
export type ScriptState = "idle" | "running" | "done" | "error";

export interface HiveConfig {
  scripts?: { setup?: string; run?: Record<string, string> };
  port?: number;
}

export interface ScriptStatusInfo {
  state: ScriptState;
  exitCode?: number;
}

export interface WorkspaceScriptsResponse {
  config: HiveConfig | null;
  status: Record<string, ScriptStatusInfo>;
}

// ── Diff types ───────────────────────────────────────────────────────

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffFileStat {
  file: string;
  additions: number;
  deletions: number;
  status: DiffFileStatus;
  renamedFrom?: string;
}

export interface DiffStatResponse {
  committed: DiffFileStat[];
  uncommitted: DiffFileStat[];
}

// ── Interactive tool input types ─────────────────────────────────────

export type ToolInputResult =
  | { type: "answer"; answers: QuestionAnswer[]; questions?: QuestionInput[] }
  | { type: "approve" }
  | { type: "reject"; message?: string }
  | { type: "dismiss"; message?: string };

export interface QuestionAnswer {
  questionIndex: number;
  selectedOptions: number[];
  customText?: string;
}

export interface QuestionInput {
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

// ── WebSocket protocol ──────────────────────────────────────────────

/** Per-message options that control agent CLI behavior. */
export interface MessageOptions {
  planMode?: boolean;
  thinkingEnabled?: boolean;
  /** Compound model ID: "provider:model", e.g. "claude:opus-4-6" or "codex:gpt-5.3-codex" */
  model?: string;
  /** Codex reasoning effort level (ignored by Claude provider). */
  thinkingLevel?: ThinkingLevel;
}

export type ThinkingLevel = "low" | "medium" | "high" | "xhigh";

/** Frontend -> Backend */
export type WsIncoming =
  | { type: "switch_session"; sessionId: string }
  | { type: "user_message"; content: string; images?: ImageAttachment[]; options?: MessageOptions; sessionId?: string }
  | { type: "stop"; sessionId?: string }
  | { type: "tool_input_response"; requestId: string; toolName: string; result: ToolInputResult; sessionId?: string };

/** Backend -> Frontend */
export type WsOutgoing =
  | { type: "text_delta"; sessionId: string; text: string }
  | { type: "thinking"; sessionId: string; text: string }
  | { type: "tool_use"; sessionId: string; id: string; name: string; input: string; parentToolUseId?: string }
  | { type: "tool_result"; sessionId: string; toolUseId: string; output: string }
  | { type: "tool_input_required"; sessionId: string; requestId: string; toolName: string; toolUseId: string; input: unknown }
  | { type: "done"; sessionId: string; costUsd?: number; durationMs?: number }
  | { type: "error"; message: string }
  | { type: "cancelled"; sessionId: string }
  | { type: "status"; status: WorkspaceStatus; sessionId?: string; streaming?: boolean; streamingStartedAt?: number; lockedProvider?: string }
  | { type: "user_message"; message: ChatMessage }
  | { type: "history"; messages: ChatMessage[]; sessionId?: string }
  | { type: "branch_info"; info: BranchInfo }
  | { type: "diff_stats"; stats: DiffStatResponse }
  | { type: "script_status"; scriptType: ScriptType; state: ScriptState; exitCode?: number };
