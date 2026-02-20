import { EventEmitter } from "node:events";
import type { StreamParserEvent } from "../stream-parser.js";
import type { StreamAdapter } from "./types.js";

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

interface CodexTurnCompleted {
  type: "turn.completed";
  usage?: { input_tokens: number; cached_input_tokens?: number; output_tokens: number };
}

interface CodexTurnFailed {
  type: "turn.failed";
  error?: string;
}

interface CodexItemEvent {
  type: "item.started" | "item.updated" | "item.completed";
  item: {
    id: string;
    type: "agent_message" | "reasoning" | "command_execution" | "file_change" | "mcp_tool_call" | "web_search" | "plan_update";
    text?: string;
    command?: string;
    status?: string;
    // file_change fields
    filename?: string;
    diff?: string;
    // command_execution fields
    output?: string;
    exit_code?: number;
  };
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
  web_search: "WebSearch",
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
        this.emit("result", {
          type: "result" as const,
          session_id: this.threadId ?? "",
          usage: parsed.usage
            ? { input_tokens: parsed.usage.input_tokens, output_tokens: parsed.usage.output_tokens }
            : undefined,
        });
        break;

      case "turn.failed":
        this.flushPendingText();
        this.emit("error", new Error(parsed.error ?? "Codex turn failed"));
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
        // Unknown event type — log but don't crash
        console.warn("[codex-adapter] unknown event type:", (parsed as { type: string }).type);
        break;
    }
  }

  private handleItem(event: CodexItemEvent): void {
    const { item } = event;

    switch (item.type) {
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
      case "web_search": {
        // Flush any pending text before emitting tool use
        this.flushPendingText();
        this.flushPendingThinking();

        const toolName = TOOL_NAME_MAP[item.type] ?? item.type;
        const input = this.buildToolInput(item);

        if (event.type === "item.started" || event.type === "item.updated") {
          // Emit tool_use (in progress)
          this.emit("assistant", {
            type: "assistant" as const,
            message: {
              id: item.id,
              role: "assistant" as const,
              content: [{ type: "tool_use" as const, id: item.id, name: toolName, input }],
            },
          });
        }

        if (event.type === "item.completed") {
          // Emit tool_use if not already emitted via item.started
          this.emit("assistant", {
            type: "assistant" as const,
            message: {
              id: item.id,
              role: "assistant" as const,
              content: [{ type: "tool_use" as const, id: item.id, name: toolName, input }],
            },
          });
          // Emit tool_result immediately
          const output = this.buildToolOutput(item);
          this.emit("user", {
            type: "user" as const,
            message: {
              role: "user" as const,
              content: [{ type: "tool_result" as const, tool_use_id: item.id, content: output }],
            },
          });
        }
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
        console.warn("[codex-adapter] unknown item type:", item.type);
        break;
    }
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

  private buildToolInput(item: CodexItemEvent["item"]): string {
    switch (item.type) {
      case "command_execution":
        return JSON.stringify({ command: item.command ?? "" });
      case "file_change":
        return JSON.stringify({ filename: item.filename ?? "", diff: item.diff ?? "" });
      default:
        return JSON.stringify(item);
    }
  }

  private buildToolOutput(item: CodexItemEvent["item"]): string {
    switch (item.type) {
      case "command_execution":
        return item.output ?? (item.exit_code != null ? `Exit code: ${item.exit_code}` : "");
      case "file_change":
        return item.diff ?? "File changed";
      default:
        return item.text ?? "";
    }
  }
}
