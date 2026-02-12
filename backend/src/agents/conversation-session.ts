import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import { StreamParser } from "./stream-parser.js";
import type {
  ChatMessage,
  ToolCall,
  ToolInputResult,
  SessionMetadata,
  WsOutgoing,
} from "../types.js";

export interface ConversationSessionConfig {
  cwd: string;
  dataDir: string;
  workspaceId: string;
  sessionId?: string;
  command?: string;
  systemPrompt?: string;
  skipPermissions?: boolean;
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
  private readonly systemPrompt: string | undefined;
  private readonly skipPermissions: boolean;
  private readonly sessionDir: string;
  private readonly workspaceId: string;
  private process: ChildProcess | null = null;
  private parser: StreamParser | null = null;
  private _status: "idle" | "streaming" | "error" = "idle";
  private messageCount = 0;
  private claudeSessionId: string | undefined;
  private persistQueue: Promise<void> = Promise.resolve();
  private _metadata: SessionMetadata;

  constructor(config: ConversationSessionConfig) {
    super();
    this.sessionId = config.sessionId ?? nanoid(12);
    this.cwd = config.cwd;
    this.command = config.command ?? "claude";
    this.systemPrompt = config.systemPrompt;
    this.skipPermissions = config.skipPermissions ?? true;
    this.workspaceId = config.workspaceId;
    this.sessionDir = join(config.dataDir, "sessions", this.sessionId);

    this._metadata = {
      sessionId: this.sessionId,
      workspaceId: this.workspaceId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    };
  }

  get status() {
    return this._status;
  }

  get metadata(): SessionMetadata {
    return { ...this._metadata };
  }

  /** Load a session from disk. Returns the session in idle state with history available. */
  static async load(config: ConversationSessionConfig): Promise<ConversationSession> {
    const session = new ConversationSession(config);
    try {
      const metaPath = join(session.sessionDir, "metadata.json");
      const raw = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(raw) as SessionMetadata;
      session._metadata = meta;
      session.claudeSessionId = meta.claudeSessionId;
      session.messageCount = meta.messageCount;
    } catch {
      // No persisted metadata — fresh session
    }
    return session;
  }

  /** Get all persisted messages for this session. */
  async getMessages(): Promise<ChatMessage[]> {
    await this.persistQueue;
    try {
      const messagesPath = join(this.sessionDir, "messages.jsonl");
      const raw = await readFile(messagesPath, "utf-8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ChatMessage);
    } catch {
      return [];
    }
  }

  /** Send a user message. Spawns a new claude process for this turn. */
  sendMessage(content: string): void {
    if (this._status === "streaming") {
      throw new Error("Already streaming — wait for current message to complete or stop it");
    }

    this._status = "streaming";

    // Persist user message immediately
    const userMsg: ChatMessage = {
      id: nanoid(12),
      sessionId: this.sessionId,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    void this.enqueuePersist(userMsg);
    this.emit("message", { type: "user_message", message: userMsg });

    this.messageCount++;

    // Pre-generate a Claude session ID so --resume works even after SIGKILL.
    // On the first message we pass --session-id to tell the CLI what ID to use;
    // on subsequent messages we --resume that same ID.
    const isFirstMessage = this.messageCount === 1;
    if (!this.claudeSessionId) {
      this.claudeSessionId = crypto.randomUUID();
      this._metadata.claudeSessionId = this.claudeSessionId;
    }

    const args = [
      "--print",
      "--output-format", "stream-json",
      "--verbose",
      ...(this.skipPermissions ? ["--dangerously-skip-permissions"] : []),
      ...(isFirstMessage && this.systemPrompt
        ? ["--append-system-prompt", this.systemPrompt]
        : []),
      ...(isFirstMessage
        ? ["--session-id", this.claudeSessionId]
        : ["--resume", this.claudeSessionId]),
      "-p", content,
    ];

    this.parser = new StreamParser();

    // Accumulators for building the assistant ChatMessage
    let assistantText = "";
    let thinkingText = "";
    const toolCalls: ToolCall[] = [];

    // Track blocking tools detected in the stream so the close handler can emit
    // tool_input_required events. We kill the process immediately when we see one
    // to prevent the CLI from auto-executing the tool.
    const blockingToolNames = new Set(["AskUserQuestion", "ExitPlanMode"]);
    let killedForBlockingTool = false;

    this.parser.on("assistant", (data) => {
      for (const block of data.message.content) {
        switch (block.type) {
          case "text":
            assistantText += block.text;
            this.emit("message", { type: "text_delta", text: block.text });
            break;
          case "thinking":
            thinkingText += block.thinking;
            this.emit("message", { type: "thinking", text: block.thinking });
            break;
          case "tool_use": {
            const inputStr = typeof block.input === "string"
              ? block.input
              : JSON.stringify(block.input, null, 2);
            toolCalls.push({ id: block.id, name: block.name, input: inputStr });
            this.emit("message", { type: "tool_use", id: block.id, name: block.name, input: inputStr });

            // Kill immediately to prevent CLI from auto-executing the blocking tool
            if (blockingToolNames.has(block.name) && this.process) {
              killedForBlockingTool = true;
              this.process.kill("SIGKILL");
            }
            break;
          }
        }
      }
    });

    this.parser.on("user", (data) => {
      // User messages in the stream are tool results
      for (const block of data.message.content) {
        if (block.type === "tool_result") {
          // Update the matching tool call's output
          const tc = toolCalls.find((t) => t.id === block.tool_use_id);
          if (tc) tc.output = block.content;
          this.emit("message", {
            type: "tool_result",
            toolUseId: block.tool_use_id,
            output: block.content,
          });
        }
      }
    });

    this.parser.on("result", (data) => {
      // Capture Claude's session ID from the first result
      if (data.session_id && !this.claudeSessionId) {
        this.claudeSessionId = data.session_id;
        this._metadata.claudeSessionId = data.session_id;
      }
      // done event is emitted on process close (after flush)
    });

    this.parser.on("system", (_data) => {
      // System messages (compaction etc.) — no action needed
    });

    this.parser.on("error", (err) => {
      this.emit("error", err);
    });

    this.process = spawn(this.command, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Claude can wait indefinitely when stdin is a pipe left open.
    // We only send prompt via args (`-p`), so close stdin immediately.
    this.process.stdin?.end();

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.parser?.write(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
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
      // SIGKILL for blocking tools is NOT a cancellation — it's an intentional pause
      const wasCancelled = exitCode !== 0 && this._status === "streaming" && !killedForBlockingTool;

      this._status = (exitCode === 0 || killedForBlockingTool) ? "idle" : "error";
      this.process = null;
      this.parser = null;

      // Persist assistant message
      if (assistantText || toolCalls.length > 0 || thinkingText) {
        const assistantMsg: ChatMessage = {
          id: nanoid(12),
          sessionId: this.sessionId,
          role: "assistant",
          content: assistantText,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          thinkingContent: thinkingText || undefined,
          timestamp: new Date().toISOString(),
          cancelled: wasCancelled || undefined,
        };
        void this.enqueuePersist(assistantMsg);
      }

      this._metadata.messageCount = this.messageCount;
      this._metadata.updatedAt = new Date().toISOString();
      this.persistQueue = this.persistQueue
        .then(() => this.saveMetadata())
        .catch(() => {
          // Non-fatal: metadata persistence failure should not break the session.
        });

      // When we killed the process for a blocking tool, those tools will have
      // no output (we killed before the CLI could execute them). Use the flag
      // directly instead of checking tc.output.
      const unansweredBlockingTools = killedForBlockingTool
        ? toolCalls.filter((tc) => blockingToolNames.has(tc.name))
        : [];

      void (async () => {
        await this.persistQueue;
        if (wasCancelled) {
          this.emit("message", { type: "cancelled" });
        } else {
          this.emit("message", {
            type: "done",
            sessionId: this.claudeSessionId,
          });
        }

        // Emit tool_input_required for each unanswered blocking tool
        // so the frontend can render interactive controls
        for (const tool of unansweredBlockingTools) {
          let input: unknown;
          try {
            input = JSON.parse(tool.input);
          } catch {
            input = {};
          }
          this.emit("message", {
            type: "tool_input_required",
            requestId: nanoid(12),
            toolName: tool.name,
            toolUseId: tool.id,
            input,
          });
        }

        this.emit("exit", exitCode);
      })();
    });
  }

  /** Stop the currently streaming process. */
  stop(): void {
    if (!this.process) {
      this.emit("exit", 0);
      return;
    }

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

  /** Respond to an interactive tool input (AskUserQuestion, ExitPlanMode).
   *  Formats the response and sends it as a new --resume message. */
  respondToToolInput(toolName: string, result: ToolInputResult): void {
    if (toolName === "AskUserQuestion" && result.type === "answer") {
      const formatted = result.answers.map((a) => {
        if (a.customText) return `Question ${a.questionIndex + 1}: "${a.customText}"`;
        return `Question ${a.questionIndex + 1}: Selected option(s) ${a.selectedOptions.map((i) => i + 1).join(", ")}`;
      }).join("\n");
      this.sendMessage(`Here are my answers to your questions:\n${formatted}`);
    } else if (toolName === "ExitPlanMode" && result.type === "approve") {
      this.sendMessage("I approve the plan. Please proceed with implementation.");
    } else if (result.type === "reject") {
      this.sendMessage(result.message || "I reject this. Please suggest an alternative approach.");
    }
  }

  /** Append a ChatMessage to the session's messages.jsonl */
  private async appendMessage(msg: ChatMessage): Promise<void> {
    try {
      await mkdir(this.sessionDir, { recursive: true });
      const messagesPath = join(this.sessionDir, "messages.jsonl");
      await appendFile(messagesPath, JSON.stringify(msg) + "\n", "utf-8");
    } catch {
      // Non-fatal — messages may not persist if disk fails
    }
  }

  /** Serialize message persistence to preserve order under fast process exits. */
  private enqueuePersist(msg: ChatMessage): Promise<void> {
    this.persistQueue = this.persistQueue
      .then(() => this.appendMessage(msg))
      .catch(() => {
        // Non-fatal: keep queue alive for subsequent writes.
      });
    return this.persistQueue;
  }

  /** Save session metadata to disk. */
  private async saveMetadata(): Promise<void> {
    try {
      await mkdir(this.sessionDir, { recursive: true });
      const metaPath = join(this.sessionDir, "metadata.json");
      await writeFile(metaPath, JSON.stringify(this._metadata, null, 2), "utf-8");
    } catch {
      // Non-fatal
    }
  }
}
