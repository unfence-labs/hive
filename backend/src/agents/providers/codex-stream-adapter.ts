import { EventEmitter } from "node:events";
import {
  commandExecutionActivityToToolCall,
  normalizeAgentActivityCommandActions,
} from "@hive/shared/agent-activity";
import type { StreamParserEvent } from "../stream-parser.js";
import type { StreamAdapter } from "./types.js";
import { DEBUG_AGENT_LOGS } from "../../utils/env.js";

/**
 * Codex JSONL event shapes (from `codex exec --json`).
 * Only the fields we consume are typed; the rest is passed through loosely.
 */

interface CodexThreadStarted {
  type: "thread.started";
  thread_id: string;
}

interface CodexTurnStarted {
  type: "turn.started";
}

type UnknownRecord = Record<string, unknown>;

interface CodexTurnCompleted {
  type: "turn.completed";
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
}

interface CodexTurnFailed {
  type: "turn.failed";
  error?: string | { message?: string };
}

type CodexItem = UnknownRecord & {
  id?: string;
  type?: string;
  text?: string;
  message?: string;
  command?: string;
  aggregated_output?: string;
  output?: string;
  exit_code?: number;
  status?: string;
  filename?: string;
  diff?: string;
  changes?: unknown;
  command_actions?: unknown;
  items?: unknown;
};

interface CodexItemEvent {
  type: "item.started" | "item.updated" | "item.completed";
  item: CodexItem;
}

interface CodexError {
  type: "error";
  error?: string;
  message?: string;
}

type CodexJsonLine =
  | CodexThreadStarted
  | CodexTurnStarted
  | CodexTurnCompleted
  | CodexTurnFailed
  | CodexItemEvent
  | CodexError;

/** Map codex item types to tool names for the frontend. */
const TOOL_NAME_MAP: Record<string, string> = {
  command_execution: "Bash",
  file_change: "Edit",
  mcp_tool_call: "mcp_tool_call",
  collab_tool_call: "CodexCollabTool",
  web_search: "WebSearch",
  todo_list: "TodoList",
  error: "CodexDiagnostic",
};

/**
 * Normalizes Codex CLI JSONL output into the same StreamParserEvent format
 * that conversation-session.ts expects (identical to Claude's stream-parser).
 *
 * This lets conversation-session.ts remain completely provider-agnostic.
 */
export class CodexStreamAdapter extends EventEmitter<StreamParserEvent> implements StreamAdapter {
  private buffer = "";
  private threadId: string | undefined;
  /** Accumulate text fragments across item events for a single assistant message block. */
  private pendingTextParts: string[] = [];
  private pendingThinkingParts: string[] = [];
  private emittedToolIds = new Set<string>();

  get capturedThreadId(): string | undefined {
    return this.threadId;
  }

  write(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.parseLine(trimmed);
    }
  }

  flush(): void {
    const trimmed = this.buffer.trim();
    this.buffer = "";
    if (trimmed) this.parseLine(trimmed);
    this.flushPendingText();
    this.flushPendingThinking();
  }

  private parseLine(line: string): void {
    let parsed: CodexJsonLine;
    try {
      parsed = JSON.parse(line) as CodexJsonLine;
    } catch {
      this.emit("error", new Error(`Malformed Codex JSON line: ${line.slice(0, 200)}`));
      return;
    }

    switch (parsed.type) {
      case "thread.started":
        this.threadId = parsed.thread_id;
        break;

      case "turn.started":
        // No-op — streaming status already signaled by conversation-session
        break;

      case "turn.completed":
        this.flushPendingText();
        this.flushPendingThinking();
        this.emit("result", {
          type: "result" as const,
          session_id: this.threadId ?? "",
          usage: parsed.usage && parsed.usage.input_tokens != null && parsed.usage.output_tokens != null
            ? {
                input_tokens: parsed.usage.input_tokens,
                output_tokens: parsed.usage.output_tokens,
                cache_read_input_tokens: parsed.usage.cached_input_tokens,
              }
            : undefined,
        });
        break;

      case "turn.failed":
        this.flushPendingText();
        this.flushPendingThinking();
        this.emit("error", new Error(formatErrorMessage(parsed.error, "Codex turn failed")));
        break;

      case "item.started":
      case "item.updated":
      case "item.completed":
        this.handleItem(parsed);
        break;

      case "error":
        this.emit("error", new Error(parsed.error ?? parsed.message ?? "Codex error"));
        break;

      default:
        // Unknown event type: keep the stream alive and only log in debug mode.
        debugUnknown("event", parsed);
        break;
    }
  }

  private handleItem(event: CodexItemEvent): void {
    const { item } = event;
    const itemType = item.type;
    if (!itemType) {
      debugUnknown("item", item);
      return;
    }

    switch (itemType) {
      case "agent_message":
        if (item.text) {
          this.pendingTextParts.push(item.text);
          // Emit incrementally on completed items
          if (event.type === "item.completed") {
            this.flushPendingText();
          }
        }
        break;

      case "reasoning":
        if (item.text) {
          this.pendingThinkingParts.push(item.text);
          if (event.type === "item.completed") {
            this.flushPendingThinking();
          }
        }
        break;

      case "command_execution":
      case "file_change":
      case "mcp_tool_call":
      case "collab_tool_call":
      case "web_search": {
        // Flush any pending text before emitting tool use
        this.flushPendingText();
        this.flushPendingThinking();

        const tool = this.buildTool(item, itemType);
        const toolName = tool.name;
        const input = tool.input;

        if (event.type === "item.started" || event.type === "item.updated") {
          if (itemType !== "file_change" || hasFileChangeDetails(item)) {
            this.emitToolUse(this.itemId(item), toolName, input);
          }
        }

        if (event.type === "item.completed") {
          const id = this.itemId(item);
          this.emitToolUse(id, toolName, input);
          const output = this.buildToolOutput(item);
          this.emitToolResult(id, output);
        }
        break;
      }

      case "todo_list": {
        this.flushPendingText();
        this.flushPendingThinking();
        const id = this.itemId(item);
        const input = this.buildToolInput(item);
        this.emitToolUse(id, TOOL_NAME_MAP.todo_list, input);
        this.emitToolResult(id, this.buildToolOutput(item));
        break;
      }

      case "error": {
        this.flushPendingText();
        this.flushPendingThinking();
        const id = this.itemId(item);
        const input = this.buildToolInput(item);
        this.emitToolUse(id, TOOL_NAME_MAP.error, input);
        this.emitToolResult(id, this.buildToolOutput(item));
        break;
      }

      case "plan_update":
        // Treat plan updates as text content
        if (item.text) {
          this.pendingTextParts.push(item.text);
          if (event.type === "item.completed") {
            this.flushPendingText();
          }
        }
        break;

      default:
        debugUnknown("item", item);
        break;
    }
  }

  private itemId(item: CodexItem): string {
    return item.id ?? `codex-${item.type ?? "item"}-${Date.now()}`;
  }

  private emitToolUse(id: string, name: string, input: string): void {
    if (this.emittedToolIds.has(id)) return;
    this.emittedToolIds.add(id);
    this.emit("assistant", {
      type: "assistant" as const,
      message: {
        id,
        role: "assistant" as const,
        content: [{ type: "tool_use" as const, id, name, input }],
      },
    });
  }

  private emitToolResult(id: string, output: string): void {
    this.emit("user", {
      type: "user" as const,
      message: {
        role: "user" as const,
        content: [{ type: "tool_result" as const, tool_use_id: id, content: output }],
      },
    });
  }

  private flushPendingText(): void {
    if (this.pendingTextParts.length === 0) return;
    const text = this.pendingTextParts.join("");
    this.pendingTextParts = [];
    this.emit("assistant", {
      type: "assistant" as const,
      message: {
        id: `text-${Date.now()}`,
        role: "assistant" as const,
        content: [{ type: "text" as const, text }],
      },
    });
  }

  private flushPendingThinking(): void {
    if (this.pendingThinkingParts.length === 0) return;
    const thinking = this.pendingThinkingParts.join("");
    this.pendingThinkingParts = [];
    this.emit("assistant", {
      type: "assistant" as const,
      message: {
        id: `thinking-${Date.now()}`,
        role: "assistant" as const,
        content: [{ type: "thinking" as const, thinking }],
      },
    });
  }

  private buildToolInput(item: CodexItem): string {
    switch (item.type) {
      case "command_execution":
        return JSON.stringify({ command: item.command ?? "" });
      case "file_change":
        return JSON.stringify({
          filename: item.filename ?? extractFirstChangedPath(item.changes) ?? "",
          diff: item.diff ?? "",
          changes: item.changes,
          status: item.status,
        });
      case "web_search":
        return JSON.stringify({ query: item.query ?? "", action: item.action, status: item.status });
      case "mcp_tool_call":
        return JSON.stringify({
          server: item.server,
          tool: item.tool,
          arguments: item.arguments,
          status: item.status,
        });
      case "collab_tool_call":
        return JSON.stringify(item);
      case "todo_list":
        return JSON.stringify({ items: normalizeTodoItems(item.items) });
      case "error":
        return JSON.stringify({ message: item.message ?? item.text ?? "Codex item error" });
      default:
        return JSON.stringify(item);
    }
  }

  private buildTool(item: CodexItem, itemType: string): { name: string; input: string } {
    if (itemType === "command_execution") {
      const tool = commandExecutionActivityToToolCall({
        id: this.itemId(item),
        command: item.command ?? "",
        status: item.status,
        output: this.buildToolOutput(item),
        exitCode: item.exit_code,
        commandActions: normalizeAgentActivityCommandActions(item.command_actions),
      });
      return { name: tool.name, input: tool.input };
    }
    return {
      name: TOOL_NAME_MAP[itemType] ?? itemType,
      input: this.buildToolInput(item),
    };
  }

  private buildToolOutput(item: CodexItem): string {
    switch (item.type) {
      case "command_execution":
        return item.aggregated_output ?? item.output ?? (item.exit_code != null ? `Exit code: ${item.exit_code}` : "");
      case "file_change":
        return item.diff ?? formatFileChanges(item.changes) ?? "File changed";
      case "mcp_tool_call":
        if (item.error) return formatUnknown(item.error);
        if (item.result) return formatUnknown(item.result);
        return item.status ?? "";
      case "collab_tool_call":
        return formatUnknown({
          status: item.status,
          agents_states: item.agents_states,
          receiver_thread_ids: item.receiver_thread_ids,
        });
      case "todo_list":
        return JSON.stringify({ items: normalizeTodoItems(item.items) });
      case "error":
        return item.message ?? item.text ?? "Codex item error";
      default:
        return item.text ?? "";
    }
  }
}

function formatErrorMessage(error: string | { message?: string } | undefined, fallback: string): string {
  if (typeof error === "string") return error;
  if (error?.message) return error.message;
  return fallback;
}

function normalizeTodoItems(value: unknown): Array<{ text: string; completed: boolean }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as UnknownRecord;
      const text = typeof record.text === "string" ? record.text : "";
      if (!text) return null;
      return { text, completed: Boolean(record.completed) };
    })
    .filter((item): item is { text: string; completed: boolean } => item != null);
}

function extractFirstChangedPath(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const change of value) {
    if (!change || typeof change !== "object") continue;
    const path = (change as UnknownRecord).path;
    if (typeof path === "string" && path) return path;
  }
  return undefined;
}

function hasFileChangeDetails(item: CodexItem): boolean {
  return Boolean(item.filename || item.diff || extractFirstChangedPath(item.changes));
}

function formatFileChanges(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value
    .map((change) => {
      if (!change || typeof change !== "object") return null;
      const record = change as UnknownRecord;
      const path = typeof record.path === "string" ? record.path : "(unknown)";
      const kind = typeof record.kind === "string" ? record.kind : "update";
      return `${kind}: ${path}`;
    })
    .filter((line): line is string => line != null)
    .join("\n");
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function debugUnknown(kind: "event" | "item", value: unknown): void {
  if (!DEBUG_AGENT_LOGS) return;
  const record = value && typeof value === "object" ? value as UnknownRecord : {};
  console.log(`[codex-adapter] unknown ${kind} type:`, record.type, formatUnknown(value).slice(0, 500));
}
