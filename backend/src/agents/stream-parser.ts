import { EventEmitter } from "node:events";
import type { CliJsonLine } from "../types.js";

const DEBUG_AGENT_LOGS = ["1", "true", "yes", "on"].includes(
  (process.env.HIVE_DEBUG_AGENT_LOGS ?? "").trim().toLowerCase(),
);

export type StreamParserEvent = {
  assistant: [data: Extract<CliJsonLine, { type: "assistant" }>];
  user: [data: Extract<CliJsonLine, { type: "user" }>];
  result: [data: Extract<CliJsonLine, { type: "result" }>];
  system: [data: Extract<CliJsonLine, { type: "system" }>];
  error: [err: Error];
};

/**
 * Parses newline-delimited JSON (NDJSON) from Claude CLI
 * `--print --output-format stream-json --verbose`.
 *
 * Emits typed events for each message type:
 * - `assistant` — assistant messages (text, tool_use, thinking blocks)
 * - `user` — user messages (tool_result blocks)
 * - `result` — session completion (session_id, cost, usage)
 * - `system` — system messages (compaction markers, etc.)
 * - `error` — malformed or unknown JSON lines
 */
export class StreamParser extends EventEmitter<StreamParserEvent> {
  private buffer = "";

  /** Feed a raw chunk of data (may contain partial lines). */
  write(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Last element is either empty (line ended with \n) or a partial line
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.parseLine(trimmed);
    }
  }

  /** Signal end-of-stream. Flushes any remaining buffered data. */
  flush(): void {
    const trimmed = this.buffer.trim();
    this.buffer = "";
    if (trimmed) {
      this.parseLine(trimmed);
    }
  }

  private parseLine(line: string): void {
    let raw: { type: string; [key: string]: unknown };
    try {
      raw = JSON.parse(line) as typeof raw;
    } catch {
      this.emit("error", new Error(`Malformed JSON line: ${line.slice(0, 200)}`));
      return;
    }

    // Handle CLI-internal events before narrowing to CliJsonLine
    if (raw.type === "rate_limit_event") {
      const info = raw.rate_limit_info as {
        status?: string;
        rateLimitType?: string;
        resetsAt?: number;
        overageStatus?: string;
        isUsingOverage?: boolean;
      } | undefined;
      if (info) {
        const resetsIn = info.resetsAt
          ? `${Math.max(0, Math.round((info.resetsAt * 1000 - Date.now()) / 60_000))}min`
          : "?";
        if (DEBUG_AGENT_LOGS) {
          console.log(
            "[rate-limit] status=%s window=%s resets_in=%s overage=%s",
            info.status ?? "unknown",
            info.rateLimitType ?? "?",
            resetsIn,
            info.overageStatus ?? "?",
          );
        }
      } else if (DEBUG_AGENT_LOGS) {
        console.log("[rate-limit]", JSON.stringify(raw));
      }
      return;
    }

    const parsed = raw as CliJsonLine;
    switch (parsed.type) {
      case "assistant":
        this.emit("assistant", parsed);
        break;
      case "user":
        this.emit("user", parsed);
        break;
      case "result":
        this.emit("result", parsed);
        break;
      case "system":
        this.emit("system", parsed);
        break;
      default:
        this.emit("error", new Error(`Unknown message type: ${(parsed as { type: string }).type}`));
        break;
    }
  }
}
