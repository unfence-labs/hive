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
  status: "idle" | "busy";
  createdAt: string;
  activeSessionId?: string;
  projectName?: string;
  defaultBranch?: string;
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
  pr?: PullRequestInfo | null;
  prSyncError?: string;
}

export interface WorkspaceFileTreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: WorkspaceFileTreeNode[];
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

// ── Question / Plan types (for AskUserQuestion & ExitPlanMode tools) ─

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: QuestionOption[];
}

export interface QuestionAnswer {
  questionIndex: number;
  selectedOptions: number[];
  customText?: string;
}

export function isAskUserQuestion(tool: ToolCall): boolean {
  try {
    const input = JSON.parse(tool.input);
    return tool.name === "AskUserQuestion" && Array.isArray(input?.questions);
  } catch { return false; }
}

export function isExitPlanMode(tool: ToolCall): boolean {
  return tool.name === "ExitPlanMode";
}

export function parseQuestions(tool: ToolCall): Question[] {
  try {
    return JSON.parse(tool.input).questions ?? [];
  } catch { return []; }
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
  | { type: "reject"; message?: string };

export interface QuestionInput {
  question: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

// ── Per-message options ──────────────────────────────────────────────

/** Per-message options that control Claude CLI behavior. */
export interface MessageOptions {
  planMode?: boolean;
  thinkingEnabled?: boolean;
}

// ── WebSocket protocol ──────────────────────────────────────────────

/** Frontend -> Backend */
export type WsIncoming =
  | { type: "user_message"; content: string; images?: ImageAttachment[]; options?: MessageOptions }
  | { type: "stop" }
  | { type: "tool_input_response"; requestId: string; toolName: string; result: ToolInputResult };

/** Backend -> Frontend */
export type WsOutgoing =
  | { type: "text_delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string; parentToolUseId?: string }
  | { type: "tool_result"; toolUseId: string; output: string }
  | { type: "tool_input_required"; requestId: string; toolName: string; toolUseId: string; input: unknown }
  | { type: "done"; sessionId?: string; costUsd?: number; durationMs?: number }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  | { type: "status"; status: "idle" | "busy"; sessionId?: string; streaming?: boolean }
  | { type: "user_message"; message: ChatMessage }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "branch_info"; info: BranchInfo }
  | { type: "diff_stats"; stats: DiffStatResponse };
