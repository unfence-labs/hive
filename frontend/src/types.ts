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
  | { type: "status"; status: "idle" | "busy"; sessionId?: string; streaming?: boolean }
  | { type: "history"; messages: ChatMessage[] };
