import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import { StreamParser } from "./stream-parser.js";
import type { StreamEvent, WsOutgoing } from "../types.js";

export interface ConversationSessionConfig {
  cwd: string;
  sessionId?: string;
  command?: string;
}

export type ConversationSessionEvent = {
  message: [msg: WsOutgoing];
  exit: [code: number];
  error: [err: Error];
};

export class ConversationSession extends EventEmitter<ConversationSessionEvent> {
  readonly sessionId: string;
  private readonly cwd: string;
  private readonly command: string;
  private process: ChildProcess | null = null;
  private parser: StreamParser | null = null;
  private _status: "idle" | "streaming" | "error" = "idle";
  private messageCount = 0;
  /** Tracks tool IDs by content_block index during streaming */
  private activeToolIds = new Map<number, string>();

  constructor(config: ConversationSessionConfig) {
    super();
    this.sessionId = config.sessionId ?? nanoid(12);
    this.cwd = config.cwd;
    this.command = config.command ?? "claude";
  }

  get status() {
    return this._status;
  }

  /** Send a user message. Spawns a new claude process for this turn. */
  sendMessage(content: string): void {
    if (this._status === "streaming") {
      throw new Error("Already streaming — wait for current message to complete or stop it");
    }

    this._status = "streaming";
    this.activeToolIds.clear();

    const isFirst = this.messageCount === 0;
    this.messageCount++;

    const args = [
      "-p", content,
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--dangerously-skip-permissions",
      ...(isFirst
        ? ["--session-id", this.sessionId]
        : ["--resume", this.sessionId]),
    ];

    this.parser = new StreamParser();
    this.parser.on("event", (event) => this.handleStreamEvent(event));
    this.parser.on("result", (result) => {
      // Result signals end of this turn — session_id is tracked by CLI
    });
    this.parser.on("error", (err) => {
      this.emit("error", err);
    });

    this.process = spawn(this.command, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.parser?.write(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      // stderr is informational — forward as a message, not a hard error
      // (emitting "error" without a listener throws in Node.js)
      const text = chunk.toString("utf-8").trim();
      if (text) {
        this.emit("message", { type: "error", message: `stderr: ${text}` } as WsOutgoing);
      }
    });

    this.process.on("error", (err) => {
      this._status = "error";
      this.process = null;
      this.parser = null;
      this.emit("error", err);
    });

    this.process.on("close", (code) => {
      this.parser?.flush();
      const exitCode = code ?? 1;
      this._status = exitCode === 0 ? "idle" : "error";
      this.process = null;
      this.parser = null;
      this.activeToolIds.clear();
      this.emit("exit", exitCode);
    });
  }

  /** Stop the currently streaming process. */
  stop(): void {
    if (!this.process) return;

    this.process.kill("SIGTERM");

    const timer = setTimeout(() => {
      try {
        this.process?.kill("SIGKILL");
      } catch {
        // Already exited
      }
    }, 5000);

    this.process.on("close", () => clearTimeout(timer));
  }

  private handleStreamEvent(event: StreamEvent): void {
    switch (event.type) {
      case "content_block_start": {
        if (event.content_block.type === "tool_use") {
          this.activeToolIds.set(event.index, event.content_block.id);
          this.emit("message", {
            type: "tool_use_start",
            id: event.content_block.id,
            name: event.content_block.name,
          });
        }
        break;
      }
      case "content_block_delta": {
        if (event.delta.type === "text_delta") {
          this.emit("message", {
            type: "text_delta",
            text: event.delta.text,
          });
        } else if (event.delta.type === "input_json_delta") {
          const toolId = this.activeToolIds.get(event.index);
          if (toolId) {
            this.emit("message", {
              type: "tool_use_delta",
              id: toolId,
              input: event.delta.partial_json,
            });
          }
        }
        break;
      }
      case "content_block_stop": {
        const toolId = this.activeToolIds.get(event.index);
        if (toolId) {
          this.emit("message", { type: "tool_use_end", id: toolId });
          this.activeToolIds.delete(event.index);
        }
        break;
      }
      case "message_stop": {
        this.emit("message", { type: "message_end" });
        break;
      }
      // message_start, message_delta: not directly forwarded to frontend
    }
  }
}
