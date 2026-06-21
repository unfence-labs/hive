import { EventEmitter } from "node:events";
import { copyFile, mkdir, readFile, stat, writeFile, open } from "node:fs/promises";
import { extname, join } from "node:path";
import { commandExecutionActivityToToolCall } from "@hive/shared/agent-activity";
import { workspaceFileRawPath } from "@hive/shared/workspace-files";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { AgentEventNormalizer, type NormalizedAgentEvent } from "./agent-event-normalizer.js";
import type { CodexGoalResult, CodexGoalSetParams, CodexGoalStatus } from "./providers/codex-app-server.js";
import { resolveProvider } from "./providers/registry.js";
import type { AgentProvider } from "./providers/types.js";
import { createAgentRunner, type AgentRunnerFactory } from "./runners/factory.js";
import type { AgentRunner, AgentRunnerTurnStartedEvent, StopReason } from "./runners/types.js";
import { DEBUG_AGENT_LOGS } from "../utils/env.js";
import { addBounded } from "../utils/bounded-set.js";
import type {
  AgentActivity,
  AgentActivityFile,
  ChatMessage,
  FileMention,
  ImageAttachment,
  MessageOptions,
  SessionKind,
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

/** Cap for the per-session finalized-turn dedup Set to avoid unbounded growth. */
const MAX_FINALIZED_TURN_IDS = 256;
const CODEX_GOAL_OBJECTIVE_MAX_LENGTH = 4000;

/**
 * Cap for copying a Codex-generated image into session attachments. Generated
 * images are normal-sized PNGs; anything larger is almost certainly not a
 * preview-worthy result and is skipped rather than copied wholesale.
 */
const MAX_GENERATED_IMAGE_COPY_BYTES = 25 * 1024 * 1024;

type CodexGoalCommand =
  | { type: "set"; objective: string }
  | { type: "set_status"; status: CodexGoalStatus }
  | { type: "clear" }
  | { type: "get" };

type CodexGoalRunner = AgentRunner & {
  setGoal(params: CodexGoalSetParams, options: CodexGoalRunnerOptions): Promise<CodexGoalResult>;
  getGoal(options: CodexGoalRunnerOptions): Promise<CodexGoalResult>;
  clearGoal(options: CodexGoalRunnerOptions): Promise<CodexGoalResult>;
};

type CodexGoalRunnerOptions = {
  cwd: string;
  model?: string;
  systemPrompt?: string;
  threadId?: string;
  env?: Record<string, string>;
};

function parseCodexGoalCommand(content: string): CodexGoalCommand | null {
  const trimmed = content.trim();
  if (trimmed === "/goal") return { type: "get" };
  if (!trimmed.startsWith("/goal ")) return null;

  const argument = trimmed.slice("/goal ".length).trim();
  if (!argument) return { type: "get" };
  switch (argument) {
    case "clear":
      return { type: "clear" };
    case "pause":
    case "paused":
      return { type: "set_status", status: "paused" };
    case "resume":
    case "active":
      return { type: "set_status", status: "active" };
    case "blocked":
      return { type: "set_status", status: "blocked" };
    case "complete":
    case "completed":
      return { type: "set_status", status: "complete" };
    case "usage-limited":
    case "usageLimited":
      return { type: "set_status", status: "usageLimited" };
    case "budget-limited":
    case "budgetLimited":
      return { type: "set_status", status: "budgetLimited" };
  }
  return { type: "set", objective: argument };
}

function goalCommandRequiresExistingThread(command: CodexGoalCommand): boolean {
  return command.type === "get" || command.type === "clear" || command.type === "set_status";
}

function canHandleCodexGoalCommand(
  command: CodexGoalCommand | null,
  providerId: string | undefined,
  sessionKind: SessionKind,
  testCommand: string | undefined,
): command is CodexGoalCommand {
  return command !== null
    && !testCommand
    && isInteractiveSessionKind(sessionKind)
    && providerId === "codex";
}

function isCodexGoalRunner(runner: AgentRunner): runner is CodexGoalRunner {
  const candidate = runner as Partial<CodexGoalRunner>;
  return typeof candidate.setGoal === "function"
    && typeof candidate.getGoal === "function"
    && typeof candidate.clearGoal === "function";
}

function cloneAgentActivity(activity: AgentActivity): AgentActivity {
  switch (activity.kind) {
    case "command_execution":
      return { ...activity, commandActions: activity.commandActions?.map((action) => ({ ...action })) };
    case "file_change":
      return { ...activity, files: activity.files.map((file) => ({ ...file })) };
    case "plan_update":
      return { ...activity, steps: activity.steps.map((step) => ({ ...step })) };
    case "goal_update":
      return { ...activity };
    case "image_view":
      return { ...activity };
    case "image_generation":
      return { ...activity };
    case "diagnostic":
      return { ...activity };
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

function isInteractiveSessionKind(sessionKind: SessionKind): boolean {
  return sessionKind !== "automation";
}

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
  /** Strip interactive/blocking tools — set for unattended agent runs. */
  disableInteractiveTools?: boolean;
  /** Enforce read-only execution — set for read-only agent runs. */
  readOnly?: boolean;
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
  private readonly disableInteractiveTools: boolean;
  private readonly readOnly: boolean;
  // Not readonly: load() restores the persisted kind before any use.
  private sessionKind: SessionKind;
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
  private finalizedCodexAppServerTurnIds = new Set<string>();
  private copiedGeneratedImageIds = new Set<string>();
  private pendingImageAttachments: Promise<void>[] = [];

  constructor(config: ConversationSessionConfig) {
    super();
    this.sessionId = config.sessionId ?? nanoid(12);
    this.cwd = config.cwd;
    // testCommand is only used for tests (command = "bash") — providers handle real commands
    this.testCommand = config.command !== undefined && config.command !== "claude" ? config.command : undefined;
    this.systemPrompt = config.systemPrompt;
    this.skipPermissions = config.skipPermissions ?? true;
    this.disableInteractiveTools = config.disableInteractiveTools ?? false;
    this.readOnly = config.readOnly ?? false;
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
      kind: this.sessionKind,
    };

    // Node crashes the whole process on emit("error") with zero listeners.
    // WS subscribers come and go (none are attached when no client watches the
    // workspace), so keep a permanent listener that only logs.
    this.on("error", (err) => {
      console.error(`[session] ${this.sessionId} error:`, err.message);
    });
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

  private normalizeRunOptions(
    msgOptions: MessageOptions | undefined,
    resolved: { provider: AgentProvider; modelId: string },
  ): MessageOptions {
    const { provider, modelId } = resolved;
    const model = provider.models.find((m) => m.id === modelId)
      ?? provider.models.find((m) => m.isDefault)
      ?? provider.models[0];
    const thinkingLevels = provider.capabilities.thinkingLevels;
    const thinkingLevel = thinkingLevels.length > 0
      ? (msgOptions?.thinkingLevel && thinkingLevels.includes(msgOptions.thinkingLevel)
          ? msgOptions.thinkingLevel
          : (thinkingLevels.includes("high") ? "high" : thinkingLevels[0]))
      : undefined;

    return {
      model: `${provider.id}:${model?.id ?? modelId}`,
      planMode: provider.capabilities.planMode ? msgOptions?.planMode === true : false,
      ...(thinkingLevel ? { thinkingLevel } : {}),
      fastMode: !!msgOptions?.fastMode && !!model?.supportsFastMode,
    };
  }

  private enqueueMetadataPersist(): void {
    this.persistQueue = this.persistQueue
      .then(() => this.saveMetadata())
      .catch((err) => console.error("[session] Persist metadata failed:", err));
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
      // Restore the persisted kind (absent = "chat" for old sessions) and keep
      // _metadata.kind consistent so subsequent saves never drop it.
      session.sessionKind = meta.kind ?? "chat";
      session._metadata.kind = session.sessionKind;
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
    // Terminal sessions host a shell PTY, not an agent. Never spawn a runner.
    // Defensive: the UI does not call this for terminal tabs.
    if (this.sessionKind === "terminal") {
      return;
    }
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
      this._metadata.lastRunOptions = this.normalizeRunOptions(msgOptions, resolved);
      this._metadata.updatedAt = new Date().toISOString();
      this.enqueueMetadataPersist();
    }

    const promptContent = cliContent ?? content;
    const goalCommand = images?.length ? null : parseCodexGoalCommand(content);
    if (resolved && canHandleCodexGoalCommand(goalCommand, resolved.provider.id, this.sessionKind, this.testCommand)) {
      this._status = "streaming";
      this._streamingStartedAt = Date.now();
      this.stopReason = null;
      this._lastPlanMode = false;
      this.emitUserMessage(content, undefined, fileMentions, true);
      this.startCodexGoalCommand(goalCommand, msgOptions, resolved);
      return;
    }

    this._status = "streaming";
    this._streamingStartedAt = Date.now();
    this.stopReason = null;
    this._lastPlanMode = msgOptions?.planMode ?? false;

    if (images?.length) {
      void this.saveImagesToDisk(images).then((saved) => {
        const urlImages = saved.map((s, i) => ({
          name: images[i].name,
          mediaType: images[i].mediaType,
          dataUrl: this.attachmentUrl(s.filename),
        }));
        const imagePaths = saved.map((s) => s.path);
        const useNativeCodexImages =
          !this.testCommand &&
          resolved?.provider.id === "codex" &&
          isInteractiveSessionKind(this.sessionKind);
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

  private emitUserMessage(
    content: string,
    images?: ImageAttachment[],
    fileMentions?: FileMention[],
    goalCommand?: boolean,
  ): void {
    const userMsg: ChatMessage = {
      id: nanoid(12),
      sessionId: this.sessionId,
      role: "user",
      content,
      images: images?.length ? images : undefined,
      fileMentions: fileMentions?.length ? fileMentions : undefined,
      goalCommand: goalCommand || undefined,
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

  private resetStreamAccumulators(): void {
    this._streamText = "";
    this._streamThinking = "";
    this._streamToolCalls = [];
    this._streamAgentActivities = [];
    this._agentPlanMode = false;
  }

  private beginSpontaneousCodexAppServerTurn(
    runner: AgentRunner,
    event: AgentRunnerTurnStartedEvent,
  ): boolean {
    if (this._status === "streaming") return false;

    this._status = "streaming";
    this._streamingStartedAt = Date.now();
    this.stopReason = null;
    this.runner = runner;
    this.resetStreamAccumulators();

    this.emit("message", {
      type: "status",
      status: "busy",
      sessionId: this.sessionId,
      streaming: true,
      streamingStartedAt: this._streamingStartedAt,
      lockedProvider: this._metadata.lockedProvider,
    } as WsOutgoing);

    if (DEBUG_AGENT_LOGS) {
      console.log("[session] spontaneous Codex app-server turn started", {
        sessionId: this.sessionId,
        threadId: event.threadId,
        turnId: event.turnId,
      });
    }

    return true;
  }

  private attachCodexAppServerRunnerHandlers(
    runner: AgentRunner,
    supportsBlockingTools: boolean,
    options?: { useCapturedTurnId?: boolean },
  ): { finishWithoutTurn: (exitCode: number, failureDetail?: string) => void; hasActiveTurn: () => boolean } {
    this.resetStreamAccumulators();

    let resultDurationMs: number | undefined;
    let resultInputTokens: number | undefined;
    let resultOutputTokens: number | undefined;
    let resultContextUsedTokens: number | undefined;
    let resultContextWindowTokens: number | undefined;
    let lastStderr: string | undefined;

    let normalizer = new AgentEventNormalizer();
    const blockingToolNames = new Set(["AskUserQuestion", "ExitPlanMode"]);
    let killedForBlockingTool = false;
    let finalized = false;
    let currentTurnId: string | undefined = options?.useCapturedTurnId === false
      ? undefined
      : (runner as { capturedTurnId?: string }).capturedTurnId;

    const resetPerTurnState = () => {
      resultDurationMs = undefined;
      resultInputTokens = undefined;
      resultOutputTokens = undefined;
      resultContextUsedTokens = undefined;
      resultContextWindowTokens = undefined;
      lastStderr = undefined;
      normalizer = new AgentEventNormalizer();
      killedForBlockingTool = false;
      finalized = false;
    };

    const finish = (exitCode: number, failureDetail?: string, completedTurnId?: string) => {
      const turnId = completedTurnId ?? currentTurnId;
      if (turnId) {
        if (this.finalizedCodexAppServerTurnIds.has(turnId)) return;
        addBounded(this.finalizedCodexAppServerTurnIds, turnId, MAX_FINALIZED_TURN_IDS);
      } else if (finalized) {
        // No turn id to dedup against (e.g. a /goal command that never starts a
        // turn): the runner event handlers and the goal-request promise can both
        // reach finish() — guard against a second finalizeTurn that would emit a
        // duplicate terminal event (e.g. a ghost `error` after a `cancelled`).
        return;
      }
      finalized = true;
      this.finalizeTurn({
        exitCode,
        killedForBlockingTool,
        lastStderr,
        failureDetail,
        resultDurationMs,
        resultInputTokens,
        resultOutputTokens,
        resultContextUsedTokens,
        resultContextWindowTokens,
        blockingToolNames,
      });
      currentTurnId = undefined;
    };

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
      if (data.session_id && !this.cliSessionId) {
        this.setProviderSessionId(data.session_id);
      }
      if (data.duration_ms != null) {
        resultDurationMs = data.duration_ms;
      }
      if (data.usage && resultInputTokens === undefined) {
        resultInputTokens =
          data.usage.input_tokens +
          (data.usage.cache_creation_input_tokens ?? 0) +
          (data.usage.cache_read_input_tokens ?? 0);
        resultOutputTokens = data.usage.output_tokens;
      }
      if (data.usage?.context_used_tokens != null) {
        resultContextUsedTokens = data.usage.context_used_tokens;
      }
      if (data.usage?.context_window != null) {
        resultContextWindowTokens = data.usage.context_window;
      }

      const completedTurnId = data.turn_id ?? currentTurnId;
      const status = data.status ?? "completed";
      if (status === "completed") {
        finish(this.stopReason ? 1 : 0, undefined, completedTurnId);
        return;
      }
      if (status === "interrupted") {
        const failureDetail = this.stopReason
          ? undefined
          : (data.error ?? "Codex app-server turn was interrupted.");
        finish(1, failureDetail, completedTurnId);
        return;
      }
      finish(1, data.error ?? `Codex app-server turn ended with status "${status}".`, completedTurnId);
    });

    runner.on("system", () => {
      // System messages — no action needed
    });

    runner.on("turn_started", (event) => {
      if (event.turnId && this.finalizedCodexAppServerTurnIds.has(event.turnId)) return;
      currentTurnId = event.turnId;
      if (event.threadId && !this.cliSessionId) {
        this.setProviderSessionId(event.threadId);
      }
      if (this.beginSpontaneousCodexAppServerTurn(runner, event)) {
        resetPerTurnState();
      }
    });

    runner.on("error", (err) => {
      this.emit("error", err);
      if (this._status !== "streaming" && !currentTurnId) return;
      lastStderr = sanitizeErrorDetail(err.message);
      finish(1);
    });

    return {
      finishWithoutTurn: (exitCode, failureDetail) => finish(exitCode, failureDetail),
      hasActiveTurn: () => Boolean(currentTurnId),
    };
  }

  private startCodexGoalCommand(
    command: CodexGoalCommand,
    msgOptions: MessageOptions | undefined,
    resolved: { provider: AgentProvider; modelId: string },
  ): void {
    if (command.type === "set" && command.objective.length > CODEX_GOAL_OBJECTIVE_MAX_LENGTH) {
      this.finalizeTurn({
        exitCode: 1,
        killedForBlockingTool: false,
        failureDetail: `Codex goal objective must be ${CODEX_GOAL_OBJECTIVE_MAX_LENGTH.toLocaleString("en-US")} characters or fewer.`,
        blockingToolNames: new Set(),
      });
      return;
    }

    if (goalCommandRequiresExistingThread(command) && !this.cliSessionId) {
      this.finalizeTurn({
        exitCode: 1,
        killedForBlockingTool: false,
        failureDetail: "No Codex thread exists yet. Send a message or set a goal objective first.",
        blockingToolNames: new Set(),
      });
      return;
    }

    const isFirstMessage = this.messageCount === 1;
    const runnerSelection = this.runnerFactory({
      cwd: this.cwd,
      content: "",
      msgOptions,
      resolved,
      testCommand: this.testCommand,
      isFirstMessage,
      systemPrompt: this.systemPrompt,
      skipPermissions: this.skipPermissions,
      disableInteractiveTools: this.disableInteractiveTools,
      readOnly: this.readOnly,
      browserEnv: this.browserEnv,
      sessionKind: this.sessionKind,
      providerSessionId: this.cliSessionId,
      existingCodexAppServerRunner: this.codexAppServerRunner,
    });
    if (runnerSelection.cachedCodexAppServerRunner) {
      this.codexAppServerRunner = runnerSelection.cachedCodexAppServerRunner;
    }

    const runner = runnerSelection.runner;
    runner.removeAllListeners();
    this.runner = runner;

    const controller = this.attachCodexAppServerRunnerHandlers(
      runner,
      runnerSelection.supportsBlockingTools,
      { useCapturedTurnId: false },
    );
    if (runnerSelection.protocol !== "codex_app_server" || !isCodexGoalRunner(runner)) {
      controller.finishWithoutTurn(1, "Codex app-server goal commands are unavailable.");
      return;
    }

    const model = resolved.provider.models.find((m) => m.id === resolved.modelId);
    const env = {
      ...(resolved.provider.buildEnv?.({ ...msgOptions, model: resolved.modelId }) ?? {}),
      ...(this.browserEnv ?? {}),
    };
    const goalOptions: CodexGoalRunnerOptions = {
      cwd: this.cwd,
      model: model?.cliValue ?? resolved.modelId,
      systemPrompt: this.systemPrompt,
      threadId: this.cliSessionId,
      env,
    };

    const execute = async (): Promise<CodexGoalResult> => {
      switch (command.type) {
        case "set":
          return runner.setGoal({ objective: command.objective, status: "active" }, goalOptions);
        case "set_status":
          return runner.setGoal({ status: command.status }, goalOptions);
        case "clear":
          return runner.clearGoal(goalOptions);
        case "get":
          return runner.getGoal(goalOptions);
      }
    };

    void execute()
      .then((result) => {
        if (result.threadId) {
          this.setProviderSessionId(result.threadId);
        }
        if (!controller.hasActiveTurn()) {
          controller.finishWithoutTurn(0);
        }
      })
      .catch((err: unknown) => {
        const detail = sanitizeErrorDetail(err instanceof Error ? err.message : String(err));
        if (!controller.hasActiveTurn()) {
          controller.finishWithoutTurn(1, detail);
          return;
        }
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      });
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
      disableInteractiveTools: this.disableInteractiveTools,
      readOnly: this.readOnly,
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
    this.resetStreamAccumulators();
    if (useCodexAppServer) {
      this.attachCodexAppServerRunnerHandlers(runner, supportsBlockingTools);
      runnerSelection.start();
      return;
    }

    let resultDurationMs: number | undefined;
    let resultInputTokens: number | undefined;
    let resultOutputTokens: number | undefined;
    let resultContextUsedTokens: number | undefined;
    let resultContextWindowTokens: number | undefined;
    let lastStderr: string | undefined;

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
      // Only use result-level input/output usage as fallback. Some providers
      // report cumulative turn totals here, while assistant events carry the
      // final model-call usage. Dedicated context fields are handled separately.
      if (data.usage && resultInputTokens === undefined) {
        resultInputTokens =
          data.usage.input_tokens +
          (data.usage.cache_creation_input_tokens ?? 0) +
          (data.usage.cache_read_input_tokens ?? 0);
        resultOutputTokens = data.usage.output_tokens;
      }
      if (data.usage?.context_used_tokens != null) {
        resultContextUsedTokens = data.usage.context_used_tokens;
      }
      if (data.usage?.context_window != null) {
        resultContextWindowTokens = data.usage.context_window;
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

    runner.on("stderr", ({ text }) => {
      const stderrLine = `stderr: ${sanitizeErrorDetail(text)}`;
      lastStderr = stderrLine;
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
        resultContextUsedTokens,
        resultContextWindowTokens,
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
      case "image_view_updated":
        this.handleImageViewEvent(event);
        break;
      case "image_generation_updated":
        this.handleImageGenerationEvent(event);
        break;
      case "plan_updated":
        this.handlePlanUpdateEvent(event);
        break;
      case "goal_updated":
        this.handleGoalUpdateEvent(event);
        break;
      case "diagnostic":
        this.handleDiagnosticEvent(event);
        break;
    }
    return undefined;
  }

  private upsertToolCall(id: string, name: string, input: string, parentToolUseId?: string): void {
    const existing = this._streamToolCalls.find((t) => t.id === id);
    if (existing) {
      existing.name = name;
      existing.input = input;
      if (parentToolUseId !== undefined) existing.parentToolUseId = parentToolUseId;
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
    const commandActions = event.commandActions ?? existingActivity?.commandActions;
    const activity = {
      id: event.id,
      kind: "command_execution",
      command: event.command ?? existingActivity?.command,
      cwd: event.cwd ?? existingActivity?.cwd,
      status: event.status ?? existingActivity?.status,
      output,
      exitCode: event.exitCode ?? existingActivity?.exitCode,
      durationMs: event.durationMs ?? existingActivity?.durationMs,
      commandActions,
    } satisfies Extract<AgentActivity, { kind: "command_execution" }>;
    this.upsertAgentActivity(activity);

    const existing = this._streamToolCalls.find((t) => t.id === event.id);
    const hasInputUpdate =
      event.command !== undefined ||
      event.cwd !== undefined ||
      event.status !== undefined ||
      event.exitCode !== undefined ||
      event.durationMs !== undefined ||
      event.commandActions !== undefined;

    if (!existing || hasInputUpdate) {
      const tool = commandExecutionActivityToToolCall({
        ...activity,
        parentToolUseId: existing?.parentToolUseId,
      });
      this.upsertToolCall(tool.id, tool.name, tool.input, tool.parentToolUseId);
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

  private handleImageViewEvent(event: Extract<NormalizedAgentEvent, { type: "image_view_updated" }>): void {
    this.upsertAgentActivity({
      id: event.id,
      kind: "image_view",
      path: event.path,
      relativePath: event.relativePath,
      imageUrl: event.relativePath ? workspaceFileRawPath(this.workspaceId, event.relativePath) : undefined,
      outsideWorkspace: event.outsideWorkspace,
    });
  }

  private handleImageGenerationEvent(
    event: Extract<NormalizedAgentEvent, { type: "image_generation_updated" }>,
  ): void {
    const existingActivity = this._streamAgentActivities.find(
      (activity): activity is Extract<AgentActivity, { kind: "image_generation" }> =>
        activity.id === event.id && activity.kind === "image_generation",
    );
    const relativePath = event.relativePath ?? existingActivity?.relativePath;
    const savedPath = event.savedPath ?? existingActivity?.savedPath;
    // In-workspace files are served straight from the repo; everything else
    // (Codex writes generated images to its own cache outside the workspace) is
    // copied into session attachments so it can be previewed without exposing an
    // arbitrary disk path.
    const imageUrl = relativePath
      ? workspaceFileRawPath(this.workspaceId, relativePath)
      : existingActivity?.imageUrl;
    this.upsertAgentActivity({
      id: event.id,
      kind: "image_generation",
      status: event.status ?? existingActivity?.status,
      revisedPrompt: event.revisedPrompt ?? existingActivity?.revisedPrompt,
      result: event.result ?? existingActivity?.result,
      savedPath,
      relativePath,
      imageUrl,
    });

    if (!relativePath && savedPath && !this.copiedGeneratedImageIds.has(event.id)) {
      this.copiedGeneratedImageIds.add(event.id);
      // Capture the live array reference so the deferred copy still resolves the
      // activity after the per-turn accumulators have been reset.
      const activities = this._streamAgentActivities;
      this.pendingImageAttachments.push(this.attachGeneratedImage(activities, event.id, savedPath));
    }
  }

  /**
   * Copy a Codex-generated image (saved outside the workspace) into the session
   * attachments dir and re-emit the activity with a served preview URL. Best
   * effort: a failed copy leaves the activity without a preview rather than
   * surfacing an error. `finalizeTurn` awaits these before persisting so the URL
   * lands in the saved message.
   */
  private async attachGeneratedImage(
    activities: AgentActivity[],
    activityId: string,
    savedPath: string,
  ): Promise<void> {
    try {
      const info = await stat(savedPath);
      if (!info.isFile() || info.size > MAX_GENERATED_IMAGE_COPY_BYTES) return;
      const attachmentsDir = join(this.sessionDir, "attachments");
      await mkdir(attachmentsDir, { recursive: true });
      const ext = extname(savedPath) || ".png";
      const filename = `gen-${nanoid(8)}${ext}`;
      await copyFile(savedPath, join(attachmentsDir, filename));

      const activity = activities.find(
        (item): item is Extract<AgentActivity, { kind: "image_generation" }> =>
          item.id === activityId && item.kind === "image_generation",
      );
      if (!activity) return;
      // Mutate in place: the same object is referenced by the captured array and
      // the message persisted in finalizeTurn, so this URL reaches both.
      activity.imageUrl = this.attachmentUrl(filename);
      this.emit("message", { type: "agent_activity", sessionId: this.sessionId, activity: cloneAgentActivity(activity) });
    } catch {
      // Preview is optional — keep the activity as-is when the copy fails.
    }
  }

  /** API path serving a session attachment (image previews, generated images). */
  private attachmentUrl(filename: string): string {
    return `/api/workspaces/${this.workspaceId}/sessions/${this.sessionId}/attachments/${filename}`;
  }

  private handlePlanUpdateEvent(event: Extract<NormalizedAgentEvent, { type: "plan_updated" }>): void {
    this.upsertAgentActivity({
      id: event.id,
      kind: "plan_update",
      steps: event.steps,
    });
  }

  private handleGoalUpdateEvent(event: Extract<NormalizedAgentEvent, { type: "goal_updated" }>): void {
    this.upsertAgentActivity({
      id: event.id,
      kind: "goal_update",
      active: event.active,
      threadId: event.threadId,
      objective: event.objective,
      status: event.status,
      tokenBudget: event.tokenBudget,
      tokensUsed: event.tokensUsed,
      timeUsedSeconds: event.timeUsedSeconds,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    });
  }

  private handleDiagnosticEvent(event: Extract<NormalizedAgentEvent, { type: "diagnostic" }>): void {
    this.upsertAgentActivity({
      id: event.id,
      kind: "diagnostic",
      severity: event.severity,
      title: event.title,
      message: event.message,
      source: event.source,
      method: event.method,
      details: event.details,
    });
  }

  private finalizeTurn({
    exitCode,
    killedForBlockingTool,
    lastStderr,
    failureDetail,
    resultDurationMs,
    resultInputTokens,
    resultOutputTokens,
    resultContextUsedTokens,
    resultContextWindowTokens,
    blockingToolNames,
  }: {
    exitCode: number;
    killedForBlockingTool: boolean;
    lastStderr?: string;
    failureDetail?: string;
    resultDurationMs?: number;
    resultInputTokens?: number;
    resultOutputTokens?: number;
    resultContextUsedTokens?: number;
    resultContextWindowTokens?: number;
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
    const effectiveDurationMs = resultDurationMs
      ?? (capturedStreamingStart ? Date.now() - capturedStreamingStart : undefined);

    this._status = (exitCode === 0 || killedForBlockingTool) ? "idle" : "error";
    this._streamingStartedAt = null;
    this.stopReason = null;
    this.runner = null;

    // Capture per-turn accumulators (and any pending generated-image copies)
    // before resetting, so the deferred persist below still sees this turn's
    // content even though new arrays are installed synchronously.
    const streamText = this._streamText;
    const streamThinking = this._streamThinking;
    const streamToolCalls = this._streamToolCalls;
    const streamAgentActivities = this._streamAgentActivities;
    const pendingImageAttachments = this.pendingImageAttachments;
    this.pendingImageAttachments = [];

    this._metadata.messageCount = this.messageCount;
    this._metadata.updatedAt = new Date().toISOString();
    this.enqueueMetadataPersist();

    const unansweredBlockingTools = killedForBlockingTool
      ? streamToolCalls.filter((tc) => blockingToolNames.has(tc.name))
      : [];

    this.resetStreamAccumulators();

    const pendingToolName = unansweredBlockingTools.length > 0
      ? unansweredBlockingTools[0]!.name
      : undefined;

    void (async () => {
      try {
        // Wait for generated-image copies so their served preview URLs are baked
        // into the persisted activities before the message is written.
        if (pendingImageAttachments.length > 0) {
          await Promise.allSettled(pendingImageAttachments);
        }

        // The terminal event carries the id of the assistant message persisted
        // for this turn so clients can append it optimistically and dedup the
        // next REST history fetch by id. Its presence is the single signal that
        // the turn had displayable content — for a genuinely empty turn no
        // message is saved and the event omits messageId. Generate the id once
        // here and reuse it for the persisted ChatMessage; never synthesize one
        // just for the event.
        let persistedMessageId: string | undefined;

        if (
          streamText ||
          streamToolCalls.length > 0 ||
          streamAgentActivities.length > 0 ||
          streamThinking ||
          shouldSurfaceCancelled
        ) {
          const assistantMsg: ChatMessage = {
            id: nanoid(12),
            sessionId: this.sessionId,
            role: "assistant",
            content: streamText || (shouldSurfaceCancelled ? CANCELLED_NO_OUTPUT_MESSAGE : ""),
            toolCalls: streamToolCalls.length > 0 ? streamToolCalls : undefined,
            agentActivities: streamAgentActivities.length > 0
              ? streamAgentActivities.map(cloneAgentActivity)
              : undefined,
            thinkingContent: streamThinking || undefined,
            timestamp: new Date().toISOString(),
            cancelled: shouldSurfaceCancelled || undefined,
            errorDetail: cancellationErrorDetail,
            durationMs: effectiveDurationMs,
            inputTokens: resultInputTokens,
            outputTokens: resultOutputTokens,
            contextUsedTokens: resultContextUsedTokens,
            contextWindowTokens: resultContextWindowTokens,
          };
          persistedMessageId = assistantMsg.id;
          void this.enqueuePersist(assistantMsg);
        }

        await this.persistQueue;
        if (shouldSurfaceCancelled) {
          this.emit("message", {
            type: "cancelled",
            sessionId: this.sessionId,
            // A message is persisted whenever shouldSurfaceCancelled is true, but
            // keep messageId optional in the contract and only attach it when one
            // was actually saved.
            ...(persistedMessageId ? { messageId: persistedMessageId } : {}),
            errorDetail: cancellationErrorDetail,
            userInitiated: capturedStopReason === "user",
            durationMs: effectiveDurationMs,
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
            // Attach the persisted message id only when a message was saved; for a
            // genuinely empty turn omit it. Its presence is the single signal that
            // the turn had displayable content (clients gate the optimistic append
            // on it).
            ...(persistedMessageId ? { messageId: persistedMessageId } : {}),
            durationMs: effectiveDurationMs,
            inputTokens: resultInputTokens,
            outputTokens: resultOutputTokens,
            contextUsedTokens: resultContextUsedTokens,
            contextWindowTokens: resultContextWindowTokens,
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

  /**
   * Orchestrator-owned teardown: parks the session (closing any cached Codex
   * app-server process) and drains pending persistence. Use this when an owner
   * is done with the session for good — e.g. an automation run has finished —
   * so the long-lived app-server process does not leak.
   */
  async dispose(): Promise<void> {
    this.stop("park");
    await this.drain();
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
    this.enqueueMetadataPersist();
  }

  /** Convert an empty chat session into a terminal session. Irreversible and
   *  only allowed before the first message — terminal sessions host a shell PTY,
   *  not an agent, so there must be no conversation history to strand. */
  convertToTerminal(): void {
    if (this.sessionKind === "terminal") return;
    if (this.messageCount > 0) {
      throw new Error("Cannot convert a session with messages into a terminal");
    }
    this.sessionKind = "terminal";
    this._metadata.kind = "terminal";
    this._metadata.updatedAt = new Date().toISOString();
    this.enqueueMetadataPersist();
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
