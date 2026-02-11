import { EventEmitter } from "node:events";
import type { CliJsonLine, StreamEvent } from "../types.js";

export type StreamParserEvent = {
  event: [event: StreamEvent];
  result: [data: { type: string; sessionId: string; costUsd?: number }];
  error: [err: Error];
};

/**
 * Parses newline-delimited JSON (NDJSON) from Claude CLI `--output-format stream-json`.
 * Feed raw stdout chunks via `write()`, receive typed events via EventEmitter.
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
    let parsed: CliJsonLine;
    try {
      parsed = JSON.parse(line) as CliJsonLine;
    } catch {
      this.emit("error", new Error(`Malformed JSON line: ${line.slice(0, 200)}`));
      return;
    }

    if (parsed.type === "stream_event") {
      this.emit("event", parsed.event);
    } else if (parsed.type === "result") {
      this.emit("result", {
        type: parsed.result.type,
        sessionId: parsed.session_id,
        costUsd: parsed.cost_usd,
      });
    }
    // "assistant_message" type is ignored — we reconstruct messages from stream events
  }
}
