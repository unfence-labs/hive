import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile, open } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { AgentEventNormalizer, type NormalizedAgentEvent } from "./agent-event-normalizer.js";
import { resolveProvider } from "./providers/registry.js";
import type { AgentProvider } from "./providers/types.js";
import { createAgentRunner, type AgentRunnerFactory } from "./runners/factory.js";
import type { AgentRunner, StopReason } from "./runners/types.js";
import { DEBUG_AGENT_LOGS } from "../utils/env.js";
import type {
  AgentActivity,
  AgentActivityFile,
  ChatMessage,
  FileMention,
  ImageAttachment,
  MessageOptions,
  ToolCall,
  ToolInputResult,
  SessionMetadata,
  WsOutgoing,
} from "../types.js";

const CANCELLED_NO_OUTPUT_MESSAGE = "Generation interrupted before any output.";
const MAX_ERROR_DETAIL_LENGTH = 280;

function sanitizeErrorDetail(detail: string): string {
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_ERROR_DETAIL_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`;
}

function buildCancellationErrorDetail(exitCode: number, lastStderr: string | undefined): string {
  const suffix = lastStderr ? ` | ${lastStderr}` : "";
  return sanitizeErrorDetail(`exit code ${exitCode}${suffix}`);
}

function formatNormalizedExitCode(exitCode: number | undefined): string {
  return exitCode === undefined ? "" : `Exit code: ${exitCode}`;
}

function cloneAgentActivity(activity: AgentActivity): AgentActivity {
  switch (activity.kind) {
    case "command_execution":
      return { ...activity };
    case "file_change":
      return { ...activity, files: activity.files.map((file) => ({ ...file })) };
    case "plan_update":
      return { ...activity, steps: activity.steps.map((step) => ({ ...step })) };
  }
}

function normalizeActivityFiles(
  event: Extract<NormalizedAgentEvent, { type: "file_change_updated" }>,
  existingFiles: AgentActivityFile[] | undefined,
): AgentActivityFile[] {
  if (event.files?.length) {
    return event.files.map((file) => ({ ...file }));
  }
  if (event.path) {
    return [{
      path: event.path,
      diff: event.diff,
      kind: event.kind,
      status: event.status,
    }];
  }
  return existingFiles?.map((file) => ({ ...file })) ?? [];
}

type SessionKind = "chat" | "automation";

export interface ConversationSessionConfig {
  cwd: string;
  dataDir: string;
  workspaceId: string;
  sessionId?: string;
  command?: string;
  systemPrompt?: string;
  skipPermissions?: boolean;
  browserEnv?: Record<string, string>;
  sessionKind?: SessionKind;
  runnerFactory?: AgentRunnerFactory;
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
  private readonly sessionKind: SessionKind;
  private readonly runnerFactory: AgentRunnerFactory;
  private browserEnv: Record<string, string> | undefined;
  private readonly sessionDir: string;
  private readonly workspaceId: string;
  private runner: AgentRunner | null = null;
  private codexAppServerRunner: AgentRunner | null = null;
  private _status: "idle" | "streaming" | "error" = "idle";
  private _streamingStartedAt: number | null = null;
  private messageCount = 0;
  private cliSessionId: string | undefined;
  private persistQueue: Promise<void> = Promise.resolve();
  private _lastPlanMode = false;
  private _metadata: SessionMetadata;
  private stopReason: StopReason | null = null;
  private _lastBlockingToolUseId: string | undefined;

  // In-progress streaming accumulators (instance-level for snapshot access)
  private _streamText = "";
  private _streamThinking = "";
  private _streamToolCalls: ToolCall[] = [];
  private _streamAgentActivities: AgentActivity[] = [];
  private _agentPlanMode = false;

  constructor(config: ConversationSessionConfig) {
    super();
    this.sessionId = config.sessionId ?? nanoid(12);
    this.cwd = config.cwd;
    // testCommand is only used for tests (command = "bash") — providers handle real commands
    this.testCommand = config.command !== undefined && config.command !== "claude" ? config.command : undefined;
    this.systemPrompt = config.systemPrompt;
    this.skipPermissions = config.skipPermissions ?? true;
    this.sessionKind = config.sessionKind ?? "chat";
    this.runnerFactory = config.runnerFactory ?? createAgentRunner;
    this.browserEnv = config.browserEnv;
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

  private setProviderSessionId(sessionId: string): void {
    this.cliSessionId = sessionId;
    this._metadata.providerSessionId = sessionId;
    // Keep writing the old field until persisted-session readers have migrated.
    this._metadata.claudeSessionId = sessionId;
  }

  setBrowserEnv(env: Record<string, string> | undefined): void {
    this.browserEnv = env;
  }

  /** Return a snapshot of in-progress streaming content.
   *  Returns null when the session is not streaming. Used by WS bootstrap to replay
   *  accumulated state to late-connecting clients. */
  getStreamingSnapshot(): { text: string; thinking: string; toolCalls: ToolCall[]; agentActivities: AgentActivity[]; agentPlanMode: boolean } | null {
    if (this._status !== "streaming") return null;
    return {
      text: this._streamText,
      thinking: this._streamThinking,
      toolCalls: this._streamToolCalls.map(tc => ({ ...tc })),
      agentActivities: this._streamAgentActivities.map(cloneAgentActivity),
      agentPlanMode: this._agentPlanMode,
    };
  }

  /** Load a session from disk. Returns the session in idle state with history available. */
  static async load(config: ConversationSessionConfig): Promise<ConversationSession> {
    const session = new ConversationSession(config);
    try {
      const metaPath = join(session.sessionDir, "metadata.json");
      const raw = await readFile(metaPath, "utf-8");
      const meta = JSON.parse(raw) as SessionMetadata;
      session._metadata = meta;
      session.cliSessionId = meta.providerSessionId ?? meta.claudeSessionId;
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
      const messages: ChatMessage[] = [];
      for (const line of raw.split("\n")) {
        if (!line) continue;
        try {
          messages.push(JSON.parse(line) as ChatMessage);
        } catch {
          console.warn("[session] Skipping corrupted JSONL line in", this.sessionId);
        }
      }
      return messages;
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
        const imagePaths = saved.map((s) => s.path);
        const useNativeCodexImages =
          !this.testCommand &&
          resolved?.provider.id === "codex" &&
          this.sessionKind === "chat";
        this.emitUserMessage(content, urlImages, fileMentions);
        this.startAgentTurn(
          useNativeCodexImages ? promptContent : this.buildPromptWithImages(promptContent, imagePaths),
          msgOptions,
          resolved,
          useNativeCodexImages ? imagePaths : undefined,
        );
      }).catch((err) => {
        this._status = "error";
        this._streamingStartedAt = null;
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      });
    } else {
      this.emitUserMessage(content, undefined, fileMentions);
      this.startAgentTurn(promptContent, msgOptions, resolved);
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
    const attachmentsDir = join(this.sessionDir, "attachments");
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

  /** Start a single agent turn, delegating protocol execution to the selected runner. */
  private startAgentTurn(
    content: string,
    msgOptions?: MessageOptions,
    preResolved?: { provider: AgentProvider; modelId: string },
    imagePaths?: string[],
  ): void {
    const isFirstMessage = this.messageCount === 1;

    // Use pre-resolved provider when available, otherwise resolve fresh
    const { provider, modelId } = this.testCommand
      ? { provider: null as AgentProvider | null, modelId: "" }
      : (preResolved ?? resolveProvider(msgOptions?.model));

    const runnerSelection = this.runnerFactory({
      cwd: this.cwd,
      content,
      msgOptions,
      resolved: preResolved ?? (provider ? { provider, modelId } : undefined),
      testCommand: this.testCommand,
      isFirstMessage,
      systemPrompt: this.systemPrompt,
      skipPermissions: this.skipPermissions,
      browserEnv: this.browserEnv,
      sessionKind: this.sessionKind,
      providerSessionId: this.cliSessionId,
      imagePaths,
      existingCodexAppServerRunner: this.codexAppServerRunner,
    });
    if (runnerSelection.providerSessionId && !this.cliSessionId) {
      this.setProviderSessionId(runnerSelection.providerSessionId);
    }
    if (runnerSelection.cachedCodexAppServerRunner) {
      this.codexAppServerRunner = runnerSelection.cachedCodexAppServerRunner;
    }

    const useCodexAppServer = runnerSelection.protocol === "codex_app_server";
    const supportsBlockingTools = runnerSelection.supportsBlockingTools;

    if (DEBUG_AGENT_LOGS) {
      console.log(`[session] start runner ${runnerSelection.debug.command}`, {
        provider: runnerSelection.providerId ?? "test",
        model: runnerSelection.modelId || undefined,
        msgOptions,
        args: runnerSelection.debug.args.filter((a) => a !== content && !a.includes("You are")),
      });
    }

    const runner = runnerSelection.runner;
    runner.removeAllListeners();
    this.runner = runner;

    // Reset in-progress streaming accumulators
    this._streamText = "";
    this._streamThinking = "";
    this._streamToolCalls = [];
    this._streamAgentActivities = [];
    this._agentPlanMode = false;
    let resultDurationMs: number | undefined;
    let resultInputTokens: number | undefined;
    let resultOutputTokens: number | undefined;
    let lastStderr: string | undefined;
    const emittedDiagnostics = new Set<string>();

    const normalizer = new AgentEventNormalizer();
    const blockingToolNames = new Set(["AskUserQuestion", "ExitPlanMode"]);
    let killedForBlockingTool = false;

    runner.on("assistant", (data) => {
      const blockTypes = data.message.content.map((b) => b.type);
      if (DEBUG_AGENT_LOGS) {
        console.log("[session] assistant blocks:", blockTypes, JSON.stringify(data.message.content).slice(0, 500));
      }
      for (const event of normalizer.handleAssistant(data)) {
        const usage = this.handleNormalizedAgentEvent(event, { supportsBlockingTools, blockingToolNames });
        if (usage) {
          resultInputTokens = usage.inputTokens;
          resultOutputTokens = usage.outputTokens;
        }
        if (
          event.type === "tool_started" &&
          supportsBlockingTools &&
          blockingToolNames.has(event.rawName) &&
          this.runner?.forceKill?.()
        ) {
          killedForBlockingTool = true;
          this._lastBlockingToolUseId = event.id;
        }
      }
    });

    runner.on("user", (data) => {
      for (const event of normalizer.handleUser(data)) {
        this.handleNormalizedAgentEvent(event, { supportsBlockingTools, blockingToolNames });
      }
    });

    runner.on("agent_event", (event) => {
      const usage = this.handleNormalizedAgentEvent(event, { supportsBlockingTools, blockingToolNames });
      if (usage) {
        resultInputTokens = usage.inputTokens;
        resultOutputTokens = usage.outputTokens;
      }
    });

    runner.on("result", (data) => {
      // Capture session/thread ID from first result for continuity
      if (data.session_id && !this.cliSessionId) {
        this.setProviderSessionId(data.session_id);
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

    runner.on("system", () => {
      // System messages — no action needed
    });

    runner.on("error", (err) => {
      if (!useCodexAppServer) {
        this._status = "error";
        this._streamingStartedAt = null;
        this.runner = null;
      }
      this.emit("error", err);
    });

    if (useCodexAppServer) {
      let finalized = false;
      const finish = (exitCode: number, failureDetail?: string) => {
        if (finalized) return;
        finalized = true;
        this.finalizeTurn({
          exitCode,
          killedForBlockingTool,
          lastStderr,
          failureDetail,
          resultDurationMs,
          resultInputTokens,
          resultOutputTokens,
          blockingToolNames,
        });
      };

      runner.once("result", (data) => {
        const status = data.status ?? "completed";
        if (status === "completed") {
          finish(this.stopReason ? 1 : 0);
          return;
        }
        if (status === "interrupted") {
          const failureDetail = this.stopReason
            ? undefined
            : (data.error ?? "Codex app-server turn was interrupted.");
          finish(1, failureDetail);
          return;
        }
        finish(1, data.error ?? `Codex app-server turn ended with status "${status}".`);
      });
      runner.once("error", (err) => {
        lastStderr = sanitizeErrorDetail(err.message);
        finish(1);
      });
      runnerSelection.start();
      return;
    }

    runner.on("stderr", ({ text, classification }) => {
      const stderrLine = `stderr: ${sanitizeErrorDetail(text)}`;
      lastStderr = stderrLine;
      if (classification === "diagnostic") {
        const diagnosticKey = stderrLine;
        if (emittedDiagnostics.has(diagnosticKey)) return;
        emittedDiagnostics.add(diagnosticKey);
        const id = `codex-diagnostic-${nanoid(8)}`;
        const input = JSON.stringify({
          source: "stderr",
          severity: "warning",
          message: stderrLine,
        });
        this._streamToolCalls.push({ id, name: "CodexDiagnostic", input, output: stderrLine });
        this.emit("message", { type: "tool_use", sessionId: this.sessionId, id, name: "CodexDiagnostic", input } as WsOutgoing);
        this.emit("message", { type: "tool_result", sessionId: this.sessionId, toolUseId: id, output: stderrLine } as WsOutgoing);
        return;
      }
      this.emit("message", { type: "error", message: stderrLine, sessionId: this.sessionId } as WsOutgoing);
    });

    runner.on("exit", (code, providerSessionId) => {
      if (providerSessionId) {
        this.setProviderSessionId(providerSessionId);
      }

      this.finalizeTurn({
        exitCode: code ?? 1,
        killedForBlockingTool,
        lastStderr,
        resultDurationMs,
        resultInputTokens,
        resultOutputTokens,
        blockingToolNames,
      });
    });
    runnerSelection.start();
  }

  private handleNormalizedAgentEvent(
    event: NormalizedAgentEvent,
    _context: { supportsBlockingTools: boolean; blockingToolNames: Set<string> },
  ): { inputTokens: number; outputTokens: number } | undefined {
    switch (event.type) {
      case "text_delta":
        this._streamText += event.text;
        this.emit("message", { type: "text_delta", sessionId: this.sessionId, text: event.text });
        break;
      case "thinking_delta":
        this._streamThinking += event.text;
        this.emit("message", { type: "thinking", sessionId: this.sessionId, text: event.text });
        break;
      case "tool_started":
        this.upsertToolCall(event.id, event.name, event.input, event.parentToolUseId);
        break;
      case "tool_updated": {
        const tc = this._streamToolCalls.find((t) => t.id === event.id);
        if (tc) tc.input = event.input;
        break;
      }
      case "tool_completed":
        this.completeToolCall(event.id, event.output);
        break;
      case "plan_mode_changed":
        this._agentPlanMode = event.active;
        this.emit("message", {
          type: "plan_mode_changed",
          sessionId: this.sessionId,
          active: this._agentPlanMode,
        } as WsOutgoing);
        break;
      case "redacted_thinking":
        this._streamThinking += event.text;
        break;
      case "usage_updated":
        return { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
      case "command_execution_updated":
        this.handleCommandExecutionEvent(event);
        break;
      case "file_change_updated":
        this.handleFileChangeEvent(event);
        break;
      case "plan_updated":
        this.handlePlanUpdateEvent(event);
        break;
    }
    return undefined;
  }

  private upsertToolCall(id: string, name: string, input: string, parentToolUseId?: string): void {
    const existing = this._streamToolCalls.find((t) => t.id === id);
    if (existing) {
      existing.input = input;
      return;
    }
    this._streamToolCalls.push({ id, name, input, parentToolUseId });
    this.emit("message", {
      type: "tool_use",
      sessionId: this.sessionId,
      id,
      name,
      input,
      parentToolUseId,
    });
  }

  private completeToolCall(id: string, output: string): void {
    const tc = this._streamToolCalls.find((t) => t.id === id);
    if (tc) tc.output = output;
    this.emit("message", {
      type: "tool_result",
      sessionId: this.sessionId,
      toolUseId: id,
      output,
    });
  }

  private upsertAgentActivity(activity: AgentActivity): void {
    const index = this._streamAgentActivities.findIndex((item) => item.id === activity.id);
    const next = cloneAgentActivity(activity);
    if (index >= 0) {
      this._streamAgentActivities[index] = next;
    } else {
      this._streamAgentActivities.push(next);
    }
    this.emit("message", {
      type: "agent_activity",
      sessionId: this.sessionId,
      activity: next,
    });
  }

  private handleCommandExecutionEvent(event: Extract<NormalizedAgentEvent, { type: "command_execution_updated" }>): void {
    const existingActivity = this._streamAgentActivities.find(
      (activity): activity is Extract<AgentActivity, { kind: "command_execution" }> =>
        activity.id === event.id && activity.kind === "command_execution",
    );
    const output = event.output !== undefined
      ? event.output
      : event.outputDelta !== undefined
        ? `${existingActivity?.output ?? ""}${event.outputDelta}`
        : existingActivity?.output;
    this.upsertAgentActivity({
      id: event.id,
      kind: "command_execution",
      command: event.command ?? existingActivity?.command,
      cwd: event.cwd ?? existingActivity?.cwd,
      status: event.status ?? existingActivity?.status,
      output,
      exitCode: event.exitCode ?? existingActivity?.exitCode,
      durationMs: event.durationMs ?? existingActivity?.durationMs,
    });

    const existing = this._streamToolCalls.find((t) => t.id === event.id);
    const hasInputUpdate =
      event.command !== undefined ||
      event.cwd !== undefined ||
      event.status !== undefined ||
      event.exitCode !== undefined ||
      event.durationMs !== undefined;

    if (!existing || hasInputUpdate) {
      const input = JSON.stringify({
        command: event.command ?? "",
        cwd: event.cwd,
        status: event.status,
        exitCode: event.exitCode,
        durationMs: event.durationMs,
      });
      this.upsertToolCall(event.id, "Bash", input);
    }

    const tc = this._streamToolCalls.find((t) => t.id === event.id);
    const nextOutput = event.output ?? `${tc?.output ?? ""}${event.outputDelta ?? ""}`;
    if (event.outputDelta !== undefined || event.output !== undefined || event.exitCode !== undefined) {
      this.completeToolCall(event.id, nextOutput || formatNormalizedExitCode(event.exitCode));
    }
  }

  private handleFileChangeEvent(event: Extract<NormalizedAgentEvent, { type: "file_change_updated" }>): void {
    const existingActivity = this._streamAgentActivities.find(
      (activity): activity is Extract<AgentActivity, { kind: "file_change" }> =>
        activity.id === event.id && activity.kind === "file_change",
    );
    const files = normalizeActivityFiles(event, existingActivity?.files);
    this.upsertAgentActivity({
      id: event.id,
      kind: "file_change",
      status: event.status ?? existingActivity?.status,
      files,
    });

    const combinedDiff = files.map((file) => file.diff).filter(Boolean).join("\n");
    const input = JSON.stringify({
      filename: files[0]?.path ?? event.path ?? "",
      diff: combinedDiff || event.diff || "",
      status: event.status,
      files,
    });
    this.upsertToolCall(event.id, "Edit", input);
    if (combinedDiff || event.diff || event.status) {
      this.completeToolCall(event.id, combinedDiff || event.diff || event.status || "");
    }
  }

  private handlePlanUpdateEvent(event: Extract<NormalizedAgentEvent, { type: "plan_updated" }>): void {
    this.upsertAgentActivity({
      id: event.id,
      kind: "plan_update",
      steps: event.steps,
    });
    const payload = JSON.stringify({ steps: event.steps });
    this.upsertToolCall(event.id, "TodoList", payload);
    this.completeToolCall(event.id, payload);
  }

  private finalizeTurn({
    exitCode,
    killedForBlockingTool,
    lastStderr,
    failureDetail,
    resultDurationMs,
    resultInputTokens,
    resultOutputTokens,
    blockingToolNames,
  }: {
    exitCode: number;
    killedForBlockingTool: boolean;
    lastStderr?: string;
    failureDetail?: string;
    resultDurationMs?: number;
    resultInputTokens?: number;
    resultOutputTokens?: number;
    blockingToolNames: Set<string>;
  }): void {
    const wasCancelled = !failureDetail && exitCode !== 0 && this._status === "streaming" && !killedForBlockingTool;
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
    this.runner = null;

    if (
      this._streamText ||
      this._streamToolCalls.length > 0 ||
      this._streamAgentActivities.length > 0 ||
      this._streamThinking ||
      shouldSurfaceCancelled
    ) {
      const assistantMsg: ChatMessage = {
        id: nanoid(12),
        sessionId: this.sessionId,
        role: "assistant",
        content: this._streamText || (shouldSurfaceCancelled ? CANCELLED_NO_OUTPUT_MESSAGE : ""),
        toolCalls: this._streamToolCalls.length > 0 ? this._streamToolCalls : undefined,
        agentActivities: this._streamAgentActivities.length > 0
          ? this._streamAgentActivities.map(cloneAgentActivity)
          : undefined,
        thinkingContent: this._streamThinking || undefined,
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
      ? this._streamToolCalls.filter((tc) => blockingToolNames.has(tc.name))
      : [];

    this._streamText = "";
    this._streamThinking = "";
    this._streamToolCalls = [];
    this._streamAgentActivities = [];
    this._agentPlanMode = false;

    const pendingToolName = unansweredBlockingTools.length > 0
      ? unansweredBlockingTools[0]!.name
      : undefined;

    void (async () => {
      try {
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
        } else if (failureDetail) {
          this.emit("message", {
            type: "error",
            sessionId: this.sessionId,
            message: failureDetail,
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
      } finally {
        this.emit("exit", exitCode);
      }
    })();
  }

  /** Stop the currently streaming process. */
  stop(reason: StopReason = "user"): void {
    if (reason === "park" && this.codexAppServerRunner && this.runner !== this.codexAppServerRunner) {
      this.codexAppServerRunner.close?.();
      this.codexAppServerRunner = null;
    }

    if (!this.runner) {
      this.emit("exit", 0);
      return;
    }

    this.stopReason = reason;
    this.runner.stop(reason);
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
      // Prepend \n so that even if a previous write was interrupted mid-line
      // (e.g. server crash during a large appendFile), this message starts on
      // its own line.  The reader filters blank lines produced by the double \n
      // in the normal (non-crash) case.
      // datasync() forces the kernel to flush data to disk, preventing loss on
      // hard crashes (OOM kill, power loss, SIGKILL).
      const fh = await open(messagesPath, "a");
      try {
        await fh.appendFile("\n" + JSON.stringify(msg) + "\n");
        await fh.datasync();
      } finally {
        await fh.close();
      }
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

  /** Await pending persist operations (for graceful shutdown). */
  async drain(): Promise<void> {
    if (this._status === "streaming") {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          this.off("exit", onExit);
          this.off("error", onError);
          resolve();
        };
        const onExit = () => finish();
        const onError = () => finish();

        this.on("exit", onExit);
        this.on("error", onError);

        if (this._status !== "streaming") {
          finish();
        }
      });
    }
    await this.persistQueue;
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
