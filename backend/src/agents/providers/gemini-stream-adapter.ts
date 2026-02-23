import { EventEmitter } from "node:events";
import type { StreamParserEvent } from "../stream-parser.js";
import type { StreamAdapter } from "./types.js";

/**
 * Gemini CLI NDJSON event shapes (from `gemini -p "..." -o stream-json`).
 * Only the fields we consume are typed.
 */

interface GeminiInit {
  type: "init";
  session_id: string;
  model: string;
}

interface GeminiMessage {
  type: "message";
  role: "user" | "assistant";
  content: string;
  delta?: boolean;
}

interface GeminiToolUse {
  type: "tool_use";
  tool_name: string;
  tool_id: string;
  parameters: Record<string, unknown>;
}

interface GeminiToolResult {
  type: "tool_result";
  tool_id: string;
  status: string;
  output: string;
}

interface GeminiResult {
  type: "result";
  status: string;
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cached?: number;
    duration_ms?: number;
    tool_calls?: number;
  };
}

interface GeminiError {
  type: "error";
  error?: string;
  message?: string;
}

type GeminiJsonLine =
  | GeminiInit
  | GeminiMessage
  | GeminiToolUse
  | GeminiToolResult
  | GeminiResult
  | GeminiError;

/** Map Gemini tool names to display names for the frontend. */
const TOOL_NAME_MAP: Record<string, string> = {
  run_shell_command: "Bash",
  read_file: "Read",
  write_file: "Write",
  replace_in_file: "Edit",
  search_files: "Grep",
  list_directory: "Ls",
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  glob: "Glob",
};

/**
 * Normalizes Gemini CLI NDJSON output into the same StreamParserEvent format
 * that conversation-session.ts expects (identical to Claude's stream-parser).
 */
export class GeminiStreamAdapter extends EventEmitter<StreamParserEvent> implements StreamAdapter {
  private buffer = "";
  private sessionId: string | undefined;

  get capturedSessionId(): string | undefined {
    return this.sessionId;
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
  }

  private parseLine(line: string): void {
    let parsed: GeminiJsonLine;
    try {
      parsed = JSON.parse(line) as GeminiJsonLine;
    } catch {
      this.emit("error", new Error(`Malformed Gemini JSON line: ${line.slice(0, 200)}`));
      return;
    }

    switch (parsed.type) {
      case "init":
        this.sessionId = parsed.session_id;
        break;

      case "message":
        // Only forward assistant messages; user messages are already tracked
        if (parsed.role === "assistant" && parsed.content) {
          this.emit("assistant", {
            type: "assistant" as const,
            message: {
              id: `text-${Date.now()}`,
              role: "assistant" as const,
              content: [{ type: "text" as const, text: parsed.content }],
            },
          });
        }
        break;

      case "tool_use": {
        const displayName = TOOL_NAME_MAP[parsed.tool_name] ?? parsed.tool_name;
        const input = JSON.stringify(parsed.parameters, null, 2);
        this.emit("assistant", {
          type: "assistant" as const,
          message: {
            id: parsed.tool_id,
            role: "assistant" as const,
            content: [{ type: "tool_use" as const, id: parsed.tool_id, name: displayName, input }],
          },
        });
        break;
      }

      case "tool_result":
        this.emit("user", {
          type: "user" as const,
          message: {
            role: "user" as const,
            content: [{ type: "tool_result" as const, tool_use_id: parsed.tool_id, content: parsed.output }],
          },
        });
        break;

      case "result":
        this.emit("result", {
          type: "result" as const,
          session_id: this.sessionId ?? "",
          duration_ms: parsed.stats?.duration_ms,
          usage: parsed.stats
            ? { input_tokens: parsed.stats.input_tokens ?? 0, output_tokens: parsed.stats.output_tokens ?? 0 }
            : undefined,
        });
        break;

      case "error":
        this.emit("error", new Error(parsed.error ?? parsed.message ?? "Gemini error"));
        break;

      default:
        console.warn("[gemini-adapter] unknown event type:", (parsed as { type: string }).type);
        break;
    }
  }
}
