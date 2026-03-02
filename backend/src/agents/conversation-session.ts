import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { StreamParser } from "./stream-parser.js";
import { resolveProvider } from "./providers/registry.js";
import { CodexStreamAdapter } from "./providers/codex-stream-adapter.js";
import { GeminiStreamAdapter } from "./providers/gemini-stream-adapter.js";
import type { AgentProvider, StreamAdapter } from "./providers/types.js";
import { buildWorkspaceEnv, DEBUG_AGENT_LOGS } from "../utils/env.js";
import type {
  ChatMessage,
  ContentBlock,
  FileMention,
  ImageAttachment,
  MessageOptions,
  ServerToolResultType,
  ToolCall,
  ToolInputResult,
  SessionMetadata,
  WsOutgoing,
} from "../types.js";

const CANCELLED_NO_OUTPUT_MESSAGE = "Generation interrupted before any output.";
const MAX_ERROR_DETAIL_LENGTH = 280;

/** Gemini CLI writes informational/retry messages to stderr; suppress these from error events. */
const GEMINI_STDERR_NOISE = [
  "Loaded cached credentials",
  "YOLO mode is enabled",
  "Retrying with backoff",
  "GaxiosError",
];

/** Map Anthropic server_tool_use names to their Claude Code display names. */
const serverToolNameMap: Record<string, string> = {
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  bash_code_execution: "Bash",
  text_editor_code_execution: "Edit",
};

type ServerResultBlock = Extract<ContentBlock,
  { type: ServerToolResultType } | { type: "mcp_tool_result" }
>;

/** Format server/MCP tool result content into a readable string. */
function formatServerToolResult(block: ServerResultBlock): string {
  const { content } = block;
  if (typeof content === "string") return content;

  switch (block.type) {
    case "web_search_tool_result": {
      if (!Array.isArray(content)) break;
      const summary = (content as Array<{ type?: string; title?: string; url?: string }>)
        .filter((r) => r.type === "web_search_result")
        .map((r) => `${r.title ?? "Result"}\n${r.url ?? ""}`)
        .join("\n\n");
      return summary || JSON.stringify(content);
    }
    case "bash_code_execution_tool_result": {
      if (!content || typeof content !== "object") break;
      const c = content as { stdout?: string; stderr?: string; return_code?: number };
      const parts: string[] = [];
      if (c.stdout) parts.push(c.stdout);
      if (c.stderr) parts.push(`stderr: ${c.stderr}`);
      if (c.return_code !== undefined && c.return_code !== 0) parts.push(`exit code: ${c.return_code}`);
      return parts.join("\n") || JSON.stringify(content);
    }
    case "mcp_tool_result": {
      if (!Array.isArray(content)) break;
      const texts = (content as Array<{ type?: string; text?: string }>)
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!);
      return texts.join("\n\n") || JSON.stringify(content);
    }
  }

  return JSON.stringify(content);
}

function sanitizeErrorDetail(detail: string): string {
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`;
}

function buildCancellationErrorDetail(exitCode: number, lastStderr: string | undefined): string {
  const suffix = lastStderr ? ` | ${lastStderr}` : "";
  return sanitizeErrorDetail(`exit code ${exitCode}${suffix}`);
}

type StopReason = "user" | "park";

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
  first_message: [content: string];
};

export class ConversationSession extends EventEmitter<ConversationSessionEvent> {
  readonly sessionId: string;
  private readonly cwd: string;
  private readonly testCommand: string | undefined;
  private readonly systemPrompt: string | undefined;
  private readonly skipPermissions: boolean;
  private readonly sessionDir: string;
  private readonly workspaceId: string;
  private process: ChildProcess | null = null;
  private parser: StreamAdapter | null = null;
  private _status: "idle" | "streaming" | "error" = "idle";
  private _streamingStartedAt: number | null = null;
  private messageCount = 0;
  private cliSessionId: string | undefined;
  private persistQueue: Promise<void> = Promise.resolve();
  private _lastPlanMode = false;
  private _metadata: SessionMetadata;
  private stopReason: StopReason | null = null;
  private _lastBlockingToolUseId: string | undefined;

  constructor(config: ConversationSessionConfig) {
    super();
    this.sessionId = config.sessionId ?? nanoid(12);
    this.cwd = config.cwd;
    // testCommand is only used for tests (command = "bash") — providers handle real commands
    this.testCommand = config.command !== undefined && config.command !== "claude" ? config.command : undefined;
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

  get streamingStartedAt(): number | null {
    return this._streamingStartedAt;
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
      session.cliSessionId = meta.claudeSessionId;
      session.messageCount = meta.messageCount;
      // Backfill lockedProvider for sessions created before multi-model support.
      // All pre-existing sessions were Claude-only, so default to "claude".
      if (!meta.lockedProvider && meta.messageCount > 0) {
        session._metadata.lockedProvider = "claude";
      }
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

  /** Send a user message. Spawns a CLI process for this turn.
   *  When `cliContent` is provided, it is sent to the CLI instead of `content`
   *  while the displayed/persisted message remains `content`. */
  sendMessage(content: string, msgOptions?: MessageOptions, images?: ImageAttachment[], cliContent?: string, fileMentions?: FileMention[]): void {
    if (this._status === "streaming") {
      throw new Error("Already streaming — wait for current message to complete or stop it");
    }

    // Lock provider on first message, validate on subsequent messages
    let resolved: { provider: AgentProvider; modelId: string } | undefined;
    if (!this.testCommand) {
      resolved = resolveProvider(msgOptions?.model);

      if (!this._metadata.lockedProvider) {
        this._metadata.lockedProvider = resolved.provider.id;
      } else if (this._metadata.lockedProvider !== resolved.provider.id) {
        throw new Error(`Provider mismatch: session locked to "${this._metadata.lockedProvider}"`);
      }
    }

    this._status = "streaming";
    this._streamingStartedAt = Date.now();
    this.stopReason = null;
    this._lastPlanMode = msgOptions?.planMode ?? false;

    const promptContent = cliContent ?? content;

    if (images?.length) {
      void this.saveImagesToDisk(images).then((saved) => {
        const urlImages = saved.map((s, i) => ({
          name: images[i].name,
          mediaType: images[i].mediaType,
          dataUrl: `/api/workspaces/${this.workspaceId}/sessions/${this.sessionId}/attachments/${s.filename}`,
        }));
        this.emitUserMessage(content, urlImages, fileMentions);
        this.spawnCli(this.buildPromptWithImages(promptContent, saved.map((s) => s.path)), msgOptions, resolved);
      }).catch((err) => {
        this._status = "error";
        this._streamingStartedAt = null;
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      });
    } else {
      this.emitUserMessage(content, undefined, fileMentions);
      this.spawnCli(promptContent, msgOptions, resolved);
    }
  }

  private emitUserMessage(content: string, images?: ImageAttachment[], fileMentions?: FileMention[]): void {
    const userMsg: ChatMessage = {
      id: nanoid(12),
      sessionId: this.sessionId,
      role: "user",
      content,
      images: images?.length ? images : undefined,
      fileMentions: fileMentions?.length ? fileMentions : undefined,
      timestamp: new Date().toISOString(),
    };
    if (!this._metadata.title) {
      const firstLine = content.trim().replace(/\n.*/s, "").trimEnd();
      this._metadata.title = firstLine.length > 50
        ? firstLine.slice(0, 47).trimEnd() + "..."
        : firstLine;
    }
    void this.enqueuePersist(userMsg);
    this.emit("message", { type: "user_message", message: userMsg });
    this.messageCount++;
    if (this.messageCount === 1) {
      this.emit("first_message", content);
    }
  }

  private async saveImagesToDisk(images: ImageAttachment[]): Promise<{ path: string; filename: string }[]> {
    const attachmentsDir = join(this.cwd, ".attachments");
    await mkdir(attachmentsDir, { recursive: true });

    const results: { path: string; filename: string }[] = [];
    for (const img of images) {
      const base64Match = img.dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      if (!base64Match) continue;
      const raw = Buffer.from(base64Match[1], "base64");
      // Resize to max 1568px on longest edge (Claude API resize threshold)
      let buffer: Buffer;
      let ext: string;
      try {
        buffer = await sharp(raw)
          .resize(1568, 1568, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();
        ext = "jpg";
      } catch {
        // Fallback: save original if sharp can't process it
        buffer = raw;
        ext = img.mediaType.split("/")[1] || "png";
      }
      const filename = `${nanoid(8)}.${ext}`;
      const filepath = join(attachmentsDir, filename);
      await writeFile(filepath, buffer);
      results.push({ path: filepath, filename });
    }
    return results;
  }

  private buildPromptWithImages(userText: string, imagePaths: string[]): string {
    const pathList = imagePaths.map((p) => `- ${p}`).join("\n");
    const instruction = `\n\nThe user has attached ${imagePaths.length} image(s). Use the Read tool to view them:\n${pathList}`;
    return userText.trim()
      ? `${userText}${instruction}`
      : `Please analyze the attached image(s). Use the Read tool to view them:\n${pathList}`;
  }

  /** Spawn a CLI process for a single turn, delegating to the resolved provider. */
  private spawnCli(
    content: string,
    msgOptions?: MessageOptions,
    preResolved?: { provider: AgentProvider; modelId: string },
  ): void {
    const isFirstMessage = this.messageCount === 1;

    // Use pre-resolved provider when available, otherwise resolve fresh
    const { provider, modelId } = this.testCommand
      ? { provider: null as AgentProvider | null, modelId: "" }
      : (preResolved ?? resolveProvider(msgOptions?.model));

    // Pre-generate a session ID for CLI continuity
    if (!this.cliSessionId) {
      this.cliSessionId = crypto.randomUUID();
      this._metadata.claudeSessionId = this.cliSessionId;
    }

    let command: string;
    let args: string[];
    let env: Record<string, string> | undefined;

    if (this.testCommand) {
      // Test mode: use raw command (e.g. "bash") — no provider
      command = this.testCommand;
      args = ["-c", `echo '{"type":"result","session_id":"test","duration_ms":0}'`];
      env = undefined;
    } else {
      command = provider!.command;

      // For providers without a native system-prompt flag (Codex, Gemini),
      // prepend the system prompt to the first user message content.
      let cliContent = content;
      if (isFirstMessage && this.systemPrompt && provider!.id !== "claude") {
        cliContent = `<context>\n${this.systemPrompt}\n</context>\n\n${content}`;
      }

      args = provider!.buildArgs(cliContent, { ...msgOptions, model: modelId }, {
        isFirstMessage,
        sessionId: this.cliSessionId,
        systemPrompt: this.systemPrompt,
        skipPermissions: this.skipPermissions,
      });
      env = provider!.buildEnv({ ...msgOptions, model: modelId });
    }

    const supportsBlockingTools = provider?.capabilities.blockingTools ?? false;

    if (DEBUG_AGENT_LOGS) {
      console.log(`[session] spawn ${command}`, {
        provider: provider?.id ?? "test",
        model: modelId || undefined,
        msgOptions,
        args: args.filter((a) => a !== content && !a.includes("You are")),
      });
    }

    this.parser = this.testCommand
      ? new StreamParser()
      : provider!.createStreamAdapter();

    // Accumulators for building the assistant ChatMessage
    let assistantText = "";
    let thinkingText = "";
    const toolCalls: ToolCall[] = [];
    let resultDurationMs: number | undefined;
    let resultInputTokens: number | undefined;
    let resultOutputTokens: number | undefined;
    let lastStderr: string | undefined;

    const pendingTaskStack: string[] = [];
    const blockingToolNames = new Set(["AskUserQuestion", "ExitPlanMode"]);
    let killedForBlockingTool = false;

    this.parser.on("assistant", (data) => {
      const blockTypes = data.message.content.map((b) => b.type);
      if (DEBUG_AGENT_LOGS) {
        console.log("[session] assistant blocks:", blockTypes, JSON.stringify(data.message.content).slice(0, 500));
      }
      for (const block of data.message.content) {
        switch (block.type) {
          case "text":
            assistantText += block.text;
            this.emit("message", { type: "text_delta", sessionId: this.sessionId, text: block.text });
            break;
          case "thinking":
            thinkingText += block.thinking;
            this.emit("message", { type: "thinking", sessionId: this.sessionId, text: block.thinking });
            break;
          case "tool_use":
          case "server_tool_use":
          case "mcp_tool_use": {
            // server_tool_use is emitted for Anthropic server-side tools (web_search, web_fetch, etc.).
            // mcp_tool_use is emitted for MCP server tools.
            // Map server/mcp tool names to their Claude Code equivalents for the frontend.
            const displayName = block.type === "server_tool_use"
              ? (serverToolNameMap[block.name] ?? block.name)
              : block.name;
            const inputStr = typeof block.input === "string"
              ? block.input
              : JSON.stringify(block.input, null, 2);
            const parentToolUseId = pendingTaskStack.length > 0
              ? pendingTaskStack[pendingTaskStack.length - 1]
              : undefined;
            const existingTool = toolCalls.find((t) => t.id === block.id);
            if (existingTool) {
              existingTool.input = inputStr;
            } else {
              toolCalls.push({ id: block.id, name: displayName, input: inputStr, parentToolUseId });
              this.emit("message", {
                type: "tool_use",
                sessionId: this.sessionId,
                id: block.id,
                name: displayName,
                input: inputStr,
                parentToolUseId,
              });
            }

            if (block.name === "Task") {
              pendingTaskStack.push(block.id);
            }

            // Emit plan mode state changes for UI auto-toggle
            if (block.name === "EnterPlanMode" || block.name === "ExitPlanMode") {
              this.emit("message", {
                type: "plan_mode_changed",
                sessionId: this.sessionId,
                active: block.name === "EnterPlanMode",
              } as WsOutgoing);
            }

            // Only intercept blocking tools for providers that support them
            if (supportsBlockingTools && blockingToolNames.has(block.name) && this.process) {
              killedForBlockingTool = true;
              this._lastBlockingToolUseId = block.id;
              this.process.kill("SIGKILL");
            }
            break;
          }
          case "redacted_thinking":
            // Safety-redacted thinking — opaque encrypted data, just note it happened.
            thinkingText += "[redacted]\n";
            break;
          case "web_search_tool_result":
          case "web_fetch_tool_result":
          case "bash_code_execution_tool_result":
          case "text_editor_code_execution_tool_result":
          case "mcp_tool_result": {
            // Server-side and MCP tool results arrive as assistant content blocks,
            // not as user tool_result messages. Forward them as tool_result events.
            const output = formatServerToolResult(block);
            const tc = toolCalls.find((t) => t.id === block.tool_use_id);
            if (tc) tc.output = output;
            this.emit("message", {
              type: "tool_result",
              sessionId: this.sessionId,
              toolUseId: block.tool_use_id,
              output,
            });
            break;
          }
        }
      }

      // Capture token usage from assistant message events (deduplicated: last write wins)
      const usage = data.message.usage;
      if (usage) {
        resultInputTokens =
          usage.input_tokens +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0);
        resultOutputTokens = usage.output_tokens;
      }
    });

    this.parser.on("user", (data) => {
      for (const block of data.message.content) {
        if (block.type === "tool_result") {
          const stackTop = pendingTaskStack[pendingTaskStack.length - 1];
          if (stackTop && stackTop === block.tool_use_id) {
            pendingTaskStack.pop();
          }

          const tc = toolCalls.find((t) => t.id === block.tool_use_id);
          if (tc) tc.output = block.content;
          this.emit("message", {
            type: "tool_result",
            sessionId: this.sessionId,
            toolUseId: block.tool_use_id,
            output: block.content,
          });
        }
      }
    });

    this.parser.on("result", (data) => {
      // Capture session/thread ID from first result for continuity
      if (data.session_id && !this.cliSessionId) {
        this.cliSessionId = data.session_id;
        this._metadata.claudeSessionId = data.session_id;
      }
      if (data.duration_ms != null) {
        resultDurationMs = data.duration_ms;
      }
      // Only use result-level usage as fallback — the last assistant event
      // carries the actual context-window usage for the final sub-call, while
      // the result event may report cumulative tokens across all sub-calls
      // in the turn (which can exceed the context window size).
      if (data.usage && resultInputTokens === undefined) {
        resultInputTokens =
          data.usage.input_tokens +
          (data.usage.cache_creation_input_tokens ?? 0) +
          (data.usage.cache_read_input_tokens ?? 0);
        resultOutputTokens = data.usage.output_tokens;
      }
    });

    this.parser.on("system", () => {
      // System messages — no action needed
    });

    this.parser.on("error", (err) => {
      this.emit("error", err);
    });

    this.process = spawn(command, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      ...(this.testCommand ? {} : { env: buildWorkspaceEnv(env) }),
    });

    this.process.stdin?.end();

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.parser?.write(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (!text) return;
      // Skip known informational stderr noise from Gemini CLI
      if (GEMINI_STDERR_NOISE.some((n) => text.includes(n))) return;
      const stderrLine = `stderr: ${sanitizeErrorDetail(text)}`;
      lastStderr = stderrLine;
      this.emit("message", { type: "error", message: stderrLine, sessionId: this.sessionId } as WsOutgoing);
    });

    this.process.on("error", (err) => {
      this._status = "error";
      this._streamingStartedAt = null;
      this.process = null;
      this.parser = null;
      this.emit("error", err);
    });

    this.process.on("close", (code) => {
      this.parser?.flush();

      // For Codex: capture thread_id from the stream adapter for session continuity
      if (this.parser instanceof CodexStreamAdapter && this.parser.capturedThreadId) {
        this.cliSessionId = this.parser.capturedThreadId;
        this._metadata.claudeSessionId = this.parser.capturedThreadId;
      }

      // For Gemini: capture session_id from the init event for --resume continuity
      if (this.parser instanceof GeminiStreamAdapter && this.parser.capturedSessionId) {
        this.cliSessionId = this.parser.capturedSessionId;
        this._metadata.claudeSessionId = this.parser.capturedSessionId;
      }

      const exitCode = code ?? 1;
      const wasCancelled = exitCode !== 0 && this._status === "streaming" && !killedForBlockingTool;
      const capturedStopReason = this.stopReason;
      const capturedStreamingStart = this._streamingStartedAt;
      const cancelledByPark = wasCancelled && capturedStopReason === "park";
      const shouldSurfaceCancelled = wasCancelled && !cancelledByPark;
      const cancellationErrorDetail = shouldSurfaceCancelled
        ? buildCancellationErrorDetail(exitCode, lastStderr)
        : undefined;

      this._status = (exitCode === 0 || killedForBlockingTool) ? "idle" : "error";
      this._streamingStartedAt = null;
      this.stopReason = null;
      this.process = null;
      this.parser = null;

      if (assistantText || toolCalls.length > 0 || thinkingText || shouldSurfaceCancelled) {
        const assistantMsg: ChatMessage = {
          id: nanoid(12),
          sessionId: this.sessionId,
          role: "assistant",
          content: assistantText || (shouldSurfaceCancelled ? CANCELLED_NO_OUTPUT_MESSAGE : ""),
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          thinkingContent: thinkingText || undefined,
          timestamp: new Date().toISOString(),
          cancelled: shouldSurfaceCancelled || undefined,
          errorDetail: cancellationErrorDetail,
          durationMs: resultDurationMs,
          inputTokens: resultInputTokens,
          outputTokens: resultOutputTokens,
        };
        void this.enqueuePersist(assistantMsg);
      }

      this._metadata.messageCount = this.messageCount;
      this._metadata.updatedAt = new Date().toISOString();
      this.persistQueue = this.persistQueue
        .then(() => this.saveMetadata())
        .catch((err) => console.error("[session] Persist metadata failed:", err));

      const unansweredBlockingTools = killedForBlockingTool
        ? toolCalls.filter((tc) => blockingToolNames.has(tc.name))
        : [];

      const pendingToolName = unansweredBlockingTools.length > 0
        ? unansweredBlockingTools[0]!.name
        : undefined;

      void (async () => {
        await this.persistQueue;
        if (shouldSurfaceCancelled) {
          const cancelDurationMs = resultDurationMs
            ?? (capturedStreamingStart ? Date.now() - capturedStreamingStart : undefined);
          this.emit("message", {
            type: "cancelled",
            sessionId: this.sessionId,
            errorDetail: cancellationErrorDetail,
            userInitiated: capturedStopReason === "user",
            durationMs: cancelDurationMs,
          });
        } else if (!cancelledByPark) {
          this.emit("message", {
            type: "done",
            sessionId: this.sessionId,
            durationMs: resultDurationMs,
            inputTokens: resultInputTokens,
            outputTokens: resultOutputTokens,
            pendingToolName,
          });
        }

        for (const tool of unansweredBlockingTools) {
          let input: unknown;
          try {
            input = JSON.parse(tool.input);
          } catch {
            input = {};
          }
          this.emit("message", {
            type: "tool_input_required",
            sessionId: this.sessionId,
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
  stop(reason: StopReason = "user"): void {
    if (!this.process) {
      this.emit("exit", 0);
      return;
    }
    this.stopReason = reason;

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
      const questions = result.questions ?? [];
      const formatted = result.answers.map((a) => {
        const q = questions[a.questionIndex];
        const questionLabel = q ? `"${q.question}"` : `Question ${a.questionIndex + 1}`;
        if (a.customText) return `${questionLabel} → "${a.customText}"`;
        const optionLabels = a.selectedOptions
          .map((i) => q?.options?.[i]?.label ?? `Option ${i + 1}`)
          .join(", ");
        return `${questionLabel} → ${optionLabels}`;
      }).join("\n");
      const msg = `Here are my answers to your questions:\n${formatted}`;
      if (this._lastPlanMode) {
        this.sendMessage(msg, { planMode: true });
      } else {
        this.sendMessage(msg);
      }
    } else if (toolName === "ExitPlanMode" && result.type === "approve") {
      const toolUseId = this._lastBlockingToolUseId ?? "unknown";
      this.sendMessage(
        "Plan approved. Proceed with implementation.",
        { planMode: false },
        undefined,
        `[Tool result for ExitPlanMode (${toolUseId}): Plan approved by user.]\n\nThe user has reviewed and approved your plan. You are no longer in plan mode. Execute the implementation step by step. Do NOT call ExitPlanMode again or re-propose the plan.`,
      );
    } else if (toolName === "ExitPlanMode" && result.type === "dismiss") {
      const userMsg: ChatMessage = {
        id: nanoid(12),
        sessionId: this.sessionId,
        role: "user",
        content: result.message || "Plan acknowledged.",
        timestamp: new Date().toISOString(),
      };
      void this.enqueuePersist(userMsg);
    } else if (toolName === "ExitPlanMode" && result.type === "reject") {
      const feedback = result.message || "Please suggest an alternative approach.";
      const cliPrompt = `${feedback}\n\nIMPORTANT: You are still in plan mode. Update the plan file in .claude/plans/ with these adjustments, then call ExitPlanMode to submit the updated plan for review. Do NOT modify any source code files directly.`;
      this.sendMessage(feedback, { planMode: true }, undefined, cliPrompt);
    } else if (toolName === "AskUserQuestion" && result.type === "reject" && result.message === "[question_dismissed]") {
      this.sendMessage("Question dismissed.");
    } else if (result.type === "reject") {
      this.sendMessage(result.message || "I reject this. Please suggest an alternative approach.");
    }
  }

  setTitle(title: string): void {
    this._metadata.title = title;
    this._metadata.updatedAt = new Date().toISOString();
    this.persistQueue = this.persistQueue
      .then(() => this.saveMetadata())
      .catch((err) => console.error("[session] Persist metadata failed:", err));
  }

  private async appendMessage(msg: ChatMessage): Promise<void> {
    try {
      await mkdir(this.sessionDir, { recursive: true });
      const messagesPath = join(this.sessionDir, "messages.jsonl");
      await appendFile(messagesPath, JSON.stringify(msg) + "\n", "utf-8");
    } catch (err) {
      console.error("[session] appendMessage failed:", err);
    }
  }

  private enqueuePersist(msg: ChatMessage): Promise<void> {
    this.persistQueue = this.persistQueue
      .then(() => this.appendMessage(msg))
      .catch((err) => console.error("[session] Persist message failed:", err));
    return this.persistQueue;
  }

  async persistMetadata(): Promise<void> {
    await this.saveMetadata();
  }

  private async saveMetadata(): Promise<void> {
    try {
      await mkdir(this.sessionDir, { recursive: true });
      const metaPath = join(this.sessionDir, "metadata.json");
      await writeFile(metaPath, JSON.stringify(this._metadata, null, 2), "utf-8");
    } catch (err) {
      console.error("[session] saveMetadata failed:", err);
    }
  }
}
