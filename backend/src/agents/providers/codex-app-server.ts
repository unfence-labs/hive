import { EventEmitter } from "node:events";
import { isAbsolute, relative, resolve } from "node:path";
import {
  commandExecutionActivityToToolCall,
  normalizeAgentActivityCommandActions,
  type AgentActivityCommandAction,
} from "@hive/shared/agent-activity";
import type { NormalizedAgentEvent } from "../agent-event-normalizer.js";
import type { StreamParserEvent } from "../stream-parser.js";
import type { ThinkingLevel } from "./types.js";
import { buildWorkspaceEnv } from "../../utils/env.js";
import { addBounded } from "../../utils/bounded-set.js";
import {
  JsonRpcStdioClient,
  type JsonObject,
  type JsonRpcId,
  type JsonRpcRequest,
} from "./json-rpc-stdio.js";

/** Cap for long-lived per-session turn-id dedup Sets to avoid unbounded growth. */
const MAX_TRACKED_TURN_IDS = 256;
/** Cap for the cross-turn sub-agent item dedup Set (items are far more numerous than turns). */
const MAX_TRACKED_COLLAB_ITEM_IDS = 1024;

type CodexAppServerEvent = StreamParserEvent & {
  agent_event: [event: NormalizedAgentEvent];
  turn_started: [event: { threadId?: string; turnId?: string }];
};

type UserInput =
  | { type: "text"; text: string; text_elements: unknown[] }
  | { type: "localImage"; path: string };

type ThreadStartResponse = {
  thread: { id: string };
};

type ThreadResumeResponse = {
  thread: { id: string };
};

type TurnStartResponse = {
  turn: { id: string };
};

export type CodexGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export type CodexGoal = {
  threadId: string;
  objective?: string;
  status?: CodexGoalStatus;
  tokenBudget?: number | null;
  tokensUsed?: number;
  timeUsedSeconds?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type CodexGoalSetParams = {
  objective?: string;
  status?: CodexGoalStatus;
  tokenBudget?: number | null;
};

export type CodexGoalResult = {
  threadId: string;
  goal?: CodexGoal | null;
};

type ThreadGoalResponse = {
  goal?: CodexGoal | null;
};

type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

type TokenUsage = {
  total?: TokenBreakdown;
  last?: TokenBreakdown;
  modelContextWindow?: number | null;
};

type TokenBreakdown = {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
};

type ThreadItem =
  | { type: "agentMessage"; id: string; text?: string }
  | { type: "reasoning"; id: string; summary?: string[]; content?: string[] }
  | { type: "plan"; id: string; text?: string }
  | {
      type: "commandExecution";
      id: string;
      command?: string;
      cwd?: string;
      status?: string;
      aggregatedOutput?: string | null;
      exitCode?: number | null;
      durationMs?: number | null;
      commandActions?: AgentActivityCommandAction[];
    }
  | {
      type: "fileChange";
      id: string;
      changes?: FileUpdateChange[];
      status?: string;
    }
  | {
      type: "mcpToolCall";
      id: string;
      server?: string;
      tool?: string;
      arguments?: unknown;
      status?: string;
      result?: unknown;
      error?: unknown;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace?: string | null;
      tool?: string;
      arguments?: unknown;
      status?: string;
      contentItems?: unknown[] | null;
      success?: boolean | null;
    }
  | CollabToolCallItem
  | { type: "webSearch"; id: string; query?: string; action?: unknown }
  | { type: "imageView"; id: string; path?: string }
  | {
      type: "imageGeneration";
      id: string;
      status?: string;
      revisedPrompt?: string | null;
      result?: string;
      savedPath?: string | null;
    }
  | { type: string; id?: string; [key: string]: unknown };

type CollabToolCallItem = {
  type: "collabAgentToolCall" | "collabToolCall";
  id: string;
  tool?: string;
  status?: string;
  senderThreadId?: string;
  receiverThreadId?: string;
  newThreadId?: string;
  receiverThreadIds?: string[];
  prompt?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  agentsStates?: Record<string, unknown>;
};

type FileUpdateChange = {
  path?: string;
  diff?: string;
  kind?: unknown;
};

interface CodexAppServerThreadOptions {
  cwd: string;
  model?: string;
  systemPrompt?: string;
  threadId?: string;
  env?: Record<string, string>;
  /**
   * Enforce read-only execution for the thread/turn: the read-only sandbox
   * replaces full access so an agent can inspect but not modify the workspace.
   * Defaults to off so interactive chat keeps full access.
   */
  readOnly?: boolean;
}

interface CodexAppServerTurnOptions extends CodexAppServerThreadOptions {
  content: string;
  imagePaths?: string[];
  thinkingLevel?: ThinkingLevel;
}

interface CodexAppServerSessionOptions {
  enableGoals?: boolean;
}

const CLIENT_INFO = {
  name: "hive",
  title: "Hive",
  version: "0.1.0",
};
const MAX_DIAGNOSTIC_DETAILS_LENGTH = 4000;
/** Keep persisted chat payloads bounded when an image generation result is inline base64. */
const MAX_IMAGE_GENERATION_RESULT_LENGTH = 262_144;
const COLLAB_THREAD_REPLAY_TIMEOUT_MS = 1500;

/**
 * Canonical `codex app-server` CLI args. Single source of truth so the real spawn
 * (CodexAppServerSession) and the runner factory's debug.args can never drift.
 */
export function buildCodexAppServerArgs(enableGoals: boolean): string[] {
  return [
    "app-server",
    ...(enableGoals ? ["--enable", "goals"] : []),
    "--listen",
    "stdio://",
  ];
}

/**
 * Per-chat-session bridge to `codex app-server`.
 *
 * The generated App Server schema is very large and changes with the installed
 * Codex version, so this bridge keeps a deliberately small typed surface for the
 * protocol fields Hive consumes and leaves unknown fields untouched.
 */
export class CodexAppServerSession extends EventEmitter<CodexAppServerEvent> {
  private readonly enableGoals: boolean;
  private rpc: JsonRpcStdioClient | null = null;
  private initialized: Promise<void> | null = null;
  private threadId: string | undefined;
  private activeTurnId: string | undefined;
  private emittedToolIds = new Set<string>();
  private commandOutputs = new Map<string, string>();
  private fileChanges = new Map<string, FileUpdateChange[]>();
  private emittedAgentText = new Set<string>();
  private emittedReasoningText = new Set<string>();
  private emittedDiagnostics = new Set<string>();
  private completedToolIds = new Set<string>();
  private completedTurnIds = new Set<string>();
  private collabParentByThreadId = new Map<string, string>();
  private toolParentByItemId = new Map<string, string>();
  /** Sub-agent item ids already rendered, across turns. Collab replays on
   *  wait/closeAgent re-deliver a child thread's full history; once the
   *  per-turn dedup sets are reset (next turn), only this set prevents the
   *  previous turn's child tools from re-emitting as duplicates. */
  private completedCollabItemIds = new Set<string>();
  private pendingCollabReplays = new Set<Promise<void>>();
  private lastUsage: TokenUsage | undefined;
  private lastProtocolError: string | undefined;
  private activeGoalRequestCount = 0;
  private pendingGoalNotificationEchoKeys = new Set<string>();
  private goalNotificationKeysDuringRequest = new Set<string>();
  private currentCwd: string | undefined;

  constructor(options: CodexAppServerSessionOptions = {}) {
    super();
    this.enableGoals = options.enableGoals ?? false;
  }

  get capturedThreadId(): string | undefined {
    return this.threadId;
  }

  get capturedTurnId(): string | undefined {
    return this.activeTurnId;
  }

  write(_chunk: string): void {
    // App Server messages are read from the owned process in this class.
  }

  flush(): void {
    // No buffered parser state to flush; JSONL framing is handled in onStdout.
  }

  async startTurn(options: CodexAppServerTurnOptions): Promise<void> {
    await this.ensureInitialized(options.env);
    const previousThreadId = this.threadId;
    this.resetForUserTurn();
    this.currentCwd = options.cwd;
    const threadId = await this.ensureThread(options);
    if (threadId !== previousThreadId) {
      this.resetForThreadBoundary();
    }
    this.threadId = threadId;
    const input: UserInput[] = [
      { type: "text", text: options.content, text_elements: [] },
      ...(options.imagePaths ?? []).map((path) => ({ type: "localImage" as const, path })),
    ];
    const response = await this.request<TurnStartResponse>("turn/start", {
      threadId: this.threadId,
      input,
      cwd: options.cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: options.readOnly ? "readOnly" : "dangerFullAccess" },
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinkingLevel ? { effort: options.thinkingLevel } : {}),
    });
    this.activeTurnId = response.turn.id;
  }

  async setGoal(params: CodexGoalSetParams, options: CodexAppServerThreadOptions): Promise<CodexGoalResult> {
    return this.runGoalRequest(async () => {
      const threadId = await this.prepareGoalThread(options);
      const response = await this.request<ThreadGoalResponse>("thread/goal/set", {
        threadId,
        ...params,
      });
      this.emitGoalResponse(threadId, response, true);
      return { threadId, goal: response.goal };
    });
  }

  async getGoal(options: CodexAppServerThreadOptions): Promise<CodexGoalResult> {
    return this.runGoalRequest(async () => {
      const threadId = await this.prepareGoalThread(options);
      const response = await this.request<ThreadGoalResponse>("thread/goal/get", { threadId });
      this.emitGoalResponse(threadId, response, Boolean(response.goal));
      return { threadId, goal: response.goal };
    });
  }

  async clearGoal(options: CodexAppServerThreadOptions): Promise<CodexGoalResult> {
    return this.runGoalRequest(async () => {
      const threadId = await this.prepareGoalThread(options);
      await this.request("thread/goal/clear", { threadId });
      this.emitGoalUpdate({ threadId }, false, "response");
      return { threadId, goal: null };
    });
  }

  interruptActiveTurn(): void {
    if (!this.threadId || !this.activeTurnId) return;
    const threadId = this.threadId;
    const turnId = this.activeTurnId;
    void this.request("turn/interrupt", { threadId, turnId }).catch(() => {
      // Codex rejects interrupts for turns it no longer tracks (e.g. a missed
      // turn/completed left a stale active turn id). The user asked to stop:
      // treat the turn as over so the session finalizes instead of staying
      // "running" forever with a turn Codex already forgot.
      if (this.activeTurnId !== turnId || this.threadId !== threadId) return;
      this.activeTurnId = undefined;
      addBounded(this.completedTurnIds, turnId, MAX_TRACKED_TURN_IDS);
      this.emitInterruptedResult(turnId);
    });
  }

  close(): void {
    const interruptedTurnId = this.activeTurnId;
    const rpc = this.rpc;
    this.rpc = null;
    this.initialized = null;
    this.activeTurnId = undefined;
    this.threadId = undefined;
    this.resetForThreadBoundary();
    rpc?.close(new Error("Codex app-server closed"));
    if (interruptedTurnId) {
      // Closing with a live turn is a cancellation, not an error: emit a
      // terminal result so the conversation layer always finalizes. (This used
      // to emit "error", which crashed the process as an unhandled EventEmitter
      // error when no WS client was subscribed to the session.)
      addBounded(this.completedTurnIds, interruptedTurnId, MAX_TRACKED_TURN_IDS);
      queueMicrotask(() => this.emitInterruptedResult(interruptedTurnId));
    }
  }

  /** Emit a terminal interrupted result for a turn that will never complete normally.
   *  Deliberately carries no session/thread id: a synthetic termination must not
   *  persist provider continuity (e.g. a force-closed thread should not be resumed). */
  private emitInterruptedResult(turnId: string): void {
    this.emit("result", {
      type: "result",
      session_id: "",
      status: "interrupted",
      turn_id: turnId,
      usage: usageFromTokenUsage(this.lastUsage),
    });
  }

  private async ensureInitialized(env: Record<string, string> | undefined): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      const rpc = new JsonRpcStdioClient({
        command: "codex",
        args: buildCodexAppServerArgs(this.enableGoals),
        env: buildWorkspaceEnv(env),
      });
      this.rpc = rpc;
      rpc.on("stderr", (text) => this.emit("system", { type: "system", message: text, level: "debug" }));
      rpc.on("error", (err) => this.emit("error", err));
      rpc.on("close", (err) => this.onRpcClosed(err));
      rpc.on("request", (request) => this.handleServerRequest(request));
      rpc.on("notification", (notification) => this.handleNotification(notification.method, notification.params));
      rpc.start();

      await this.request("initialize", {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true },
      });
      this.notify("initialized");
    })();
    return this.initialized;
  }


  private async prepareGoalThread(options: CodexAppServerThreadOptions): Promise<string> {
    await this.ensureInitialized(options.env);
    const previousThreadId = this.threadId;
    this.resetForUserTurn();
    this.currentCwd = options.cwd;
    const threadId = await this.ensureThread(options);
    if (threadId !== previousThreadId) {
      this.resetForThreadBoundary();
    }
    this.threadId = threadId;
    return threadId;
  }

  private async ensureThread(options: CodexAppServerThreadOptions): Promise<string> {
    // The sandbox is derived from the CURRENT run's readOnly and applied to both
    // thread/start and thread/resume. Codex does NOT pin the sandbox to a thread's
    // creation policy — per the app-server protocol, thread/resume "accepts the same
    // permission override rules as thread/start", so the resume sandbox is honored.
    // This is correct for our model: readOnly is a per-run property (the agent's
    // current setting), automations use a fresh thread per run (start, not resume),
    // and interactive chat never sets readOnly. So a thread is never resumed with a
    // *changed* readOnly today. If a future swarm shares one long-lived thread across
    // turns with differing readOnly intents, decide explicitly whether to pin to the
    // creation policy or keep re-applying the current value here.
    const sandbox = options.readOnly ? "read-only" : "danger-full-access";
    if (options.threadId) {
      const resumed = await this.request<ThreadResumeResponse>("thread/resume", {
        threadId: options.threadId,
        cwd: options.cwd,
        approvalPolicy: "never",
        sandbox,
        ...(options.model ? { model: options.model } : {}),
        ...(options.systemPrompt ? { developerInstructions: options.systemPrompt } : {}),
      });
      return resumed.thread.id;
    }

    if (this.threadId) return this.threadId;

    const started = await this.request<ThreadStartResponse>("thread/start", {
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox,
      ...(options.model ? { model: options.model } : {}),
      ...(options.systemPrompt ? { developerInstructions: options.systemPrompt } : {}),
    });
    return started.thread.id;
  }

  private emitGoalResponse(threadId: string, response: ThreadGoalResponse, active: boolean): void {
    this.emitGoalUpdate(response.goal ? { goal: response.goal, threadId } : { threadId }, active, "response");
  }

  private async runGoalRequest<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeGoalRequestCount === 0) {
      this.pendingGoalNotificationEchoKeys.clear();
      this.goalNotificationKeysDuringRequest.clear();
    }
    this.activeGoalRequestCount += 1;
    try {
      return await operation();
    } finally {
      this.activeGoalRequestCount = Math.max(0, this.activeGoalRequestCount - 1);
      if (this.activeGoalRequestCount === 0) {
        this.goalNotificationKeysDuringRequest.clear();
      }
    }
  }

  private resetForUserTurn(): void {
    this.resetForNewTurn();
    this.collabParentByThreadId.clear();
    this.toolParentByItemId.clear();
    // A pending goal-echo key only exists to swallow the single notification that
    // echoes a just-issued goal response. A new user turn is a context boundary:
    // drop it so a later genuine identical-state thread/goal/updated (e.g. the
    // goal cycling back to a previously-read state) is not silently suppressed.
    this.pendingGoalNotificationEchoKeys.clear();
  }

  private resetForThreadBoundary(): void {
    this.collabParentByThreadId.clear();
    this.toolParentByItemId.clear();
    this.completedCollabItemIds.clear();
    this.pendingGoalNotificationEchoKeys.clear();
    this.goalNotificationKeysDuringRequest.clear();
  }

  /**
   * Per-turn reset run on each `turn/started`. Clears turn-scoped dedup/accumulator
   * state but deliberately PRESERVES the collab/tool parent maps: with goals a single
   * prompt spans several autonomous turns, and a sub-agent thread spawned in one turn
   * can emit live items in a later turn. Wiping the maps here would orphan those child
   * tool calls (they'd render top-level instead of nested under their Agent tool call).
   */
  private resetForNewTurn(): void {
    this.activeTurnId = undefined;
    this.emittedToolIds.clear();
    this.commandOutputs.clear();
    this.fileChanges.clear();
    this.emittedAgentText.clear();
    this.emittedReasoningText.clear();
    this.emittedDiagnostics.clear();
    this.completedToolIds.clear();
    this.pendingCollabReplays.clear();
    this.lastUsage = undefined;
    this.lastProtocolError = undefined;
  }

  private request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return this.rpc?.request<T>(method, params)
      ?? Promise.reject(new Error("Codex app-server is not running"));
  }

  private notify(method: string, params?: unknown): void {
    this.rpc?.notify(method, params);
  }

  private handleServerRequest(request: JsonRpcRequest): void {
    switch (request.method) {
      case "item/commandExecution/requestApproval":
        this.respond(request.id, { decision: "accept" });
        break;
      case "item/fileChange/requestApproval":
        this.respond(request.id, { decision: "accept" });
        break;
      case "execCommandApproval":
        this.respond(request.id, { decision: "approved" });
        break;
      case "applyPatchApproval":
        this.respond(request.id, { decision: "approved" });
        break;
      case "item/permissions/requestApproval":
        this.rejectUnsupportedRequest(request, "Permission approval requests are not supported by Hive");
        break;
      case "item/tool/requestUserInput":
        this.rejectUnsupportedRequest(request, "Tool user-input requests are not supported by Hive");
        break;
      case "mcpServer/elicitation/request":
        this.rejectUnsupportedRequest(request, "MCP elicitation requests are not supported by Hive");
        break;
      case "item/tool/call":
        this.rejectUnsupportedRequest(request, "Tool call requests are not supported by Hive");
        break;
      default:
        this.rejectUnsupportedRequest(request, `${request.method} is not supported by Hive`);
        break;
    }
  }

  private respond(id: JsonRpcId, result: unknown): void {
    this.rpc?.respond(id, result);
  }

  private respondError(id: JsonRpcId, message: string): void {
    this.rpc?.respondError(id, message);
  }

  private rejectUnsupportedRequest(request: JsonRpcRequest, message: string): void {
    this.respondError(request.id, message);
    this.emitDiagnostic({
      id: diagnosticId("codex-request", request.method),
      severity: "error",
      title: "Unsupported App Server request",
      message,
      method: request.method,
      details: formatDiagnosticDetails(request.params),
      dedupeKey: `request:${request.method}`,
    });
  }

  private handleNotification(method: string, params: unknown): void {
    const data = asRecord(params);
    switch (method) {
      case "thread/started":
        // Only adopt a thread id when we do not own one yet: the App Server
        // auto-attaches this connection to spawned sub-agent threads, and a
        // foreign id here would corrupt turn tracking for the main thread.
        this.threadId ??= asString(asRecord(data?.thread)?.id);
        break;
      case "turn/started": {
        // Sub-agent (collab) threads emit their own turn lifecycle. Tracking
        // them as the active turn would make the main thread's turn/completed
        // look stale and get dropped, leaving the session streaming forever.
        if (this.isForeignThread(asString(data?.threadId))) break;
        const turn = asRecord(data?.turn);
        const threadId = asString(data?.threadId) ?? this.threadId;
        const turnId = asString(turn?.id);
        if (threadId) {
          this.threadId = threadId;
        }
        if (turnId && turnId !== this.activeTurnId) {
          this.resetForNewTurn();
          this.activeTurnId = turnId;
        } else {
          this.activeTurnId = turnId ?? this.activeTurnId;
        }
        this.emit("turn_started", { threadId, turnId });
        break;
      }
      case "thread/tokenUsage/updated":
        if (this.isForeignThread(asString(data?.threadId))) break;
        this.lastUsage = asRecord(data?.tokenUsage) as TokenUsage | undefined;
        break;
      case "remoteControl/status/changed":
      case "account/rateLimits/updated":
      case "turn/diff/updated":
      case "thread/settings/updated":
      case "serverRequest/resolved":
        break;
      case "mcpServer/startupStatus/updated":
        if (isNotificationStatus(data, "failed", "cancelled")) {
          this.emitProtocolDiagnostic(method, data, "Codex MCP startup status", "warning");
        }
        break;
      case "thread/status/changed":
        if (isNotificationStatus(data, "systemError")) {
          this.emitProtocolDiagnostic(method, data, "Codex thread status", "error");
        }
        break;
      case "item/agentMessage/delta":
        this.emitTextDelta(asString(data?.itemId), asString(data?.delta));
        break;
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
        this.emitThinkingDelta(asString(data?.itemId), asString(data?.delta));
        break;
      case "item/started":
        this.handleItem(asRecord(data?.item) as ThreadItem | null, "started", {
          threadId: asString(data?.threadId),
        });
        break;
      case "item/completed":
        this.handleItem(asRecord(data?.item) as ThreadItem | null, "completed", {
          threadId: asString(data?.threadId),
        });
        break;
      case "item/commandExecution/outputDelta": {
        const itemId = asString(data?.itemId);
        const delta = asString(data?.delta);
        if (itemId && delta) {
          const parentToolUseId = this.parentToolUseIdForThread(asString(data?.threadId)) ?? this.toolParentByItemId.get(itemId);
          const next = `${this.commandOutputs.get(itemId) ?? ""}${delta}`;
          this.commandOutputs.set(itemId, next);
          if (parentToolUseId) break;
          this.emit("agent_event", {
            type: "command_execution_updated",
            id: itemId,
            outputDelta: delta,
            output: next,
          });
        }
        break;
      }
      case "item/commandExecution/terminalInteraction":
        if (asString(data?.stdin) === "") break;
        this.emitUnsupportedNotification(method, params);
        break;
      case "item/fileChange/patchUpdated": {
        const itemId = asString(data?.itemId);
        const changes = asArray(data?.changes) as FileUpdateChange[] | undefined;
        if (itemId && changes) {
          const parentToolUseId = this.parentToolUseIdForThread(asString(data?.threadId)) ?? this.toolParentByItemId.get(itemId);
          this.fileChanges.set(itemId, changes);
          if (parentToolUseId) {
            this.emitChildFileChangeTools(itemId, changes, undefined, "started", parentToolUseId);
          } else {
            this.emitFileChangeEvents(itemId, changes);
          }
        }
        break;
      }
      case "turn/plan/updated":
        // Sub-agent threads maintain their own plan; without this filter their
        // steps would surface as a parasitic card in the main task tracker.
        if (this.isForeignThread(asString(data?.threadId))) break;
        this.emitPlanUpdate(data);
        break;
      case "thread/goal/updated":
        this.emitGoalUpdate(data, true, "notification");
        break;
      case "thread/goal/cleared":
        this.emitGoalUpdate(data, false, "notification");
        break;
      case "warning":
        this.emitProtocolDiagnostic(method, data, "Codex warning", "warning");
        break;
      case "configWarning":
        this.emitProtocolDiagnostic(method, data, "Codex configuration warning", "warning");
        break;
      case "deprecationNotice":
        this.emitProtocolDiagnostic(method, data, "Codex deprecation notice", "warning");
        break;
      case "guardianWarning":
        this.emitProtocolDiagnostic(method, data, "Codex guardian warning", "warning");
        break;
      case "turn/completed": {
        this.handleTurnCompleted(data);
        break;
      }
      case "error": {
        const message = formatErrorNotification(data);
        this.lastProtocolError = message;
        this.emitDiagnostic({
          id: diagnosticId("codex-diagnostic", method),
          severity: "error",
          title: "Codex error",
          message,
          method,
          details: formatDiagnosticDetails(data),
          dedupeKey: `diagnostic:${method}:${message}`,
        });
        break;
      }
      default:
        this.emitUnsupportedNotification(method, params);
        break;
    }
  }

  private emitUnsupportedNotification(method: string, params: unknown): void {
    this.emitDiagnostic({
      id: diagnosticId("codex-notification", method),
      severity: "info",
      title: "Unsupported App Server event",
      message: `Hive does not render "${method}" yet.`,
      method,
      details: formatDiagnosticDetails(params),
      dedupeKey: `notification:${method}`,
    });
  }

  private emitProtocolDiagnostic(
    method: string,
    data: JsonObject | null,
    title: string,
    severity: "info" | "warning" | "error",
  ): void {
    this.emitDiagnostic({
      id: diagnosticId("codex-diagnostic", method),
      severity,
      title,
      message: diagnosticMessage(data, title),
      method,
      details: formatDiagnosticDetails(data),
      dedupeKey: `diagnostic:${method}:${diagnosticMessage(data, title)}`,
    });
  }

  private emitDiagnostic(event: {
    id: string;
    severity: "info" | "warning" | "error";
    title: string;
    message: string;
    method?: string;
    details?: string;
    dedupeKey: string;
  }): void {
    if (this.emittedDiagnostics.has(event.dedupeKey)) return;
    this.emittedDiagnostics.add(event.dedupeKey);
    this.emit("agent_event", {
      type: "diagnostic",
      id: event.id,
      severity: event.severity,
      title: event.title,
      message: event.message,
      source: "codex_app_server",
      method: event.method,
      details: event.details,
    });
  }

  private handleItem(
    item: ThreadItem | null,
    phase: "started" | "completed",
    context: { threadId?: string; parentToolUseId?: string } = {},
  ): void {
    if (!item?.type || !item.id) return;
    const parentToolUseId = context.parentToolUseId ?? this.parentToolUseIdForThread(context.threadId);
    if (parentToolUseId) {
      // Cross-turn dedup: a child item completed in an earlier turn (per-turn
      // emitted sets reset since) must not re-emit when a later wait/closeAgent
      // replay re-delivers it. Same-turn re-delivery still flows through and is
      // handled by the per-turn dedup sets.
      if (this.completedCollabItemIds.has(item.id) && !this.emittedToolIds.has(item.id)) return;
      if (phase === "completed") {
        addBounded(this.completedCollabItemIds, item.id, MAX_TRACKED_COLLAB_ITEM_IDS);
      }
    }

    switch (item.type) {
      case "agentMessage": {
        if (parentToolUseId) break;
        const agentItem = item as Extract<ThreadItem, { type: "agentMessage" }>;
        if (phase === "completed" && agentItem.text && !this.emittedAgentText.has(agentItem.id)) {
          this.emitTextDelta(agentItem.id, agentItem.text);
        }
        break;
      }
      case "reasoning": {
        if (parentToolUseId) break;
        const reasoningItem = item as Extract<ThreadItem, { type: "reasoning" }>;
        const thinking = [...(reasoningItem.summary ?? []), ...(reasoningItem.content ?? [])].join("\n");
        if (phase === "completed" && thinking && !this.emittedReasoningText.has(reasoningItem.id)) {
          this.emitThinkingDelta(reasoningItem.id, thinking);
        }
        break;
      }
      case "plan": {
        if (parentToolUseId) break;
        const planItem = item as Extract<ThreadItem, { type: "plan" }>;
        if (phase === "completed" && planItem.text) {
          this.emitTextDelta(planItem.id, planItem.text);
        }
        break;
      }
      case "commandExecution": {
        const commandItem = item as Extract<ThreadItem, { type: "commandExecution" }>;
        const commandActions = normalizeAgentActivityCommandActions(commandItem.commandActions);
        if (parentToolUseId) {
          this.emitChildCommandTool(commandItem, phase, parentToolUseId);
          break;
        }
        this.emit("agent_event", {
          type: "command_execution_updated",
          id: commandItem.id,
          command: commandItem.command ?? "",
          cwd: commandItem.cwd,
          status: commandItem.status,
          exitCode: asNullableNumber(commandItem.exitCode),
          durationMs: asNullableNumber(commandItem.durationMs),
          commandActions,
        });
        if (phase === "completed") {
          this.emit("agent_event", {
            type: "command_execution_updated",
            id: commandItem.id,
            command: commandItem.command ?? "",
            cwd: commandItem.cwd,
            status: commandItem.status,
            output: commandItem.aggregatedOutput ?? this.commandOutputs.get(commandItem.id) ?? formatExitCode(commandItem.exitCode),
            exitCode: asNullableNumber(commandItem.exitCode),
            durationMs: asNullableNumber(commandItem.durationMs),
            commandActions,
          });
        }
        break;
      }
      case "fileChange": {
        const fileItem = item as Extract<ThreadItem, { type: "fileChange" }>;
        const changes = fileItem.changes?.length ? fileItem.changes : this.fileChanges.get(fileItem.id);
        if (parentToolUseId) {
          this.emitChildFileChangeTools(fileItem.id, changes ?? [], fileItem.status, phase, parentToolUseId);
          break;
        }
        if (changes?.length) {
          this.emitFileChangeEvents(fileItem.id, changes, fileItem.status);
        }
        break;
      }
      case "mcpToolCall": {
        const mcpItem = item as Extract<ThreadItem, { type: "mcpToolCall" }>;
        this.emitToolUse(mcpItem.id, "mcp_tool_call", JSON.stringify({
          server: mcpItem.server,
          tool: mcpItem.tool,
          arguments: mcpItem.arguments,
          status: mcpItem.status,
        }), parentToolUseId);
        if (phase === "completed") {
          this.emitToolResult(mcpItem.id, formatUnknown(mcpItem.error ?? mcpItem.result ?? mcpItem.status ?? ""));
        }
        break;
      }
      case "dynamicToolCall": {
        const dynamicItem = item as Extract<ThreadItem, { type: "dynamicToolCall" }>;
        this.emitToolUse(dynamicItem.id, dynamicItem.tool ?? "dynamic_tool_call", JSON.stringify({
          namespace: dynamicItem.namespace,
          tool: dynamicItem.tool,
          arguments: dynamicItem.arguments,
          status: dynamicItem.status,
        }), parentToolUseId);
        if (phase === "completed") {
          this.emitToolResult(dynamicItem.id, formatUnknown(dynamicItem.contentItems ?? dynamicItem.success ?? ""));
        }
        break;
      }
      case "collabAgentToolCall":
      case "collabToolCall": {
        const collabItem = item as CollabToolCallItem;
        if (parentToolUseId && this.isCollabAgentSelfReference(collabItem, context.threadId)) {
          break;
        }
        // spawnAgent owns receiver threads when observed. wait/closeAgent only
        // become fallback owners for threads whose spawn was missed.
        if (collabItem.tool === "spawnAgent") {
          this.rememberCollabAgentReceivers(collabItem);
        } else {
          this.rememberFallbackCollabAgentReceivers(collabItem);
        }
        this.emitToolUse(collabItem.id, "Agent", JSON.stringify(collabAgentToolInput(collabItem)), parentToolUseId);
        if (phase === "completed") {
          this.emitToolResult(collabItem.id, collabAgentToolResult(collabItem));
          // spawnAgent completes at thread creation: the child has no history
          // yet, and reading it races Codex's rollout flush ("rollout is
          // empty"). Catch-up replays only make sense once the child has run,
          // i.e. when a wait/closeAgent on it completes.
          if (collabItem.tool !== "spawnAgent") {
            this.queueCollabAgentReplay(collabItem);
          }
        }
        break;
      }
      case "webSearch": {
        const webItem = item as Extract<ThreadItem, { type: "webSearch" }>;
        this.emitToolUse(webItem.id, "WebSearch", JSON.stringify({ query: webItem.query ?? "", action: webItem.action }), parentToolUseId);
        if (phase === "completed") {
          this.emitToolResult(webItem.id, webItem.query ?? "");
        }
        break;
      }
      case "imageView": {
        // Sub-agent image views stay out of the main stream (like sub-agent
        // text/reasoning); otherwise they render as unattributed top-level
        // duplicates of the parent's own views.
        if (parentToolUseId) break;
        const imageItem = item as Extract<ThreadItem, { type: "imageView" }>;
        if (!imageItem.path) break;
        this.emit("agent_event", {
          type: "image_view_updated",
          id: imageItem.id,
          path: imageItem.path,
          ...relativizeWorkspacePath(imageItem.path, this.currentCwd),
        });
        break;
      }
      case "imageGeneration": {
        if (parentToolUseId) break;
        const generationItem = item as Extract<ThreadItem, { type: "imageGeneration" }>;
        const savedPath = generationItem.savedPath ?? undefined;
        const result = generationItem.result;
        this.emit("agent_event", {
          type: "image_generation_updated",
          id: generationItem.id,
          status: generationItem.status ?? (phase === "completed" ? "completed" : "inProgress"),
          revisedPrompt: generationItem.revisedPrompt ?? undefined,
          savedPath,
          relativePath: savedPath
            ? relativizeWorkspacePath(savedPath, this.currentCwd).relativePath
            : undefined,
          result: result && result.length <= MAX_IMAGE_GENERATION_RESULT_LENGTH ? result : undefined,
        });
        break;
      }
      case "userMessage":
      case "hookPrompt":
        break;
      default:
        this.emitDiagnostic({
          id: diagnosticId("codex-item", item.type),
          severity: "info",
          title: "Unsupported App Server item",
          message: `Hive does not render Codex item type "${item.type}" yet.`,
          method: `item/${item.type}`,
          details: formatDiagnosticDetails(item),
          dedupeKey: `item:${item.type}`,
        });
        break;
    }
  }

  private isCollabAgentSelfReference(
    item: CollabToolCallItem,
    threadId: string | undefined,
  ): boolean {
    return Boolean(threadId && collabAgentReceiverThreadIds(item).includes(threadId));
  }

  /** True when a notification belongs to another thread (a spawned sub-agent
   *  thread the App Server auto-attached us to), not the session's own thread. */
  private isForeignThread(threadId: string | undefined): boolean {
    return Boolean(threadId && this.threadId && threadId !== this.threadId);
  }

  private parentToolUseIdForThread(threadId: string | undefined): string | undefined {
    return threadId ? this.collabParentByThreadId.get(threadId) : undefined;
  }

  private rememberCollabAgentReceivers(item: CollabToolCallItem): void {
    for (const threadId of collabAgentReceiverThreadIds(item)) {
      this.collabParentByThreadId.set(threadId, item.id);
    }
  }

  private rememberFallbackCollabAgentReceivers(item: CollabToolCallItem): void {
    for (const threadId of collabAgentReceiverThreadIds(item)) {
      if (!this.collabParentByThreadId.has(threadId)) {
        this.collabParentByThreadId.set(threadId, item.id);
      }
    }
  }

  private queueCollabAgentReplay(item: CollabToolCallItem): void {
    const threadIds = collabAgentReceiverThreadIds(item);
    if (threadIds.length === 0) return;
    // Catch-up items nest under the spawning Agent card when known; the
    // triggering wait/closeAgent card is only a fallback for threads whose
    // spawn was never observed (e.g. resumed session).
    const replay = Promise.all(threadIds.map((threadId) =>
      this.replayCollabAgentThread(threadId, this.collabParentByThreadId.get(threadId) ?? item.id)))
      .then(() => undefined)
      .catch((err: unknown) => {
        if (isUnmaterializedThreadReadError(err)) return;
        this.emitDiagnostic({
          id: diagnosticId("codex-collab-replay", item.id),
          severity: "warning",
          title: "Codex sub-agent replay failed",
          message: err instanceof Error ? err.message : "Unable to read Codex sub-agent thread.",
          method: "thread/read",
          details: formatDiagnosticDetails({ receiverThreadIds: threadIds }),
          dedupeKey: `collab-replay:${item.id}`,
        });
      });
    this.pendingCollabReplays.add(replay);
    replay.finally(() => this.pendingCollabReplays.delete(replay));
  }

  private async replayCollabAgentThread(threadId: string, parentToolUseId: string): Promise<void> {
    const response = await this.request<{ thread?: { turns?: unknown[] } }>("thread/read", {
      threadId,
      includeTurns: true,
    });
    const turns = asArray(asRecord(response.thread)?.turns) ?? [];
    for (const turn of turns) {
      const items = asArray(asRecord(turn)?.items) ?? [];
      for (const entry of items) {
        this.handleItem(asRecord(entry) as ThreadItem | null, "completed", { threadId, parentToolUseId });
      }
    }
  }

  private handleTurnCompleted(data: JsonObject | null): void {
    // Turn completions for sub-agent threads end that sub-thread's turn, not
    // ours; only the main thread's turn/completed may finalize the session turn.
    if (this.isForeignThread(asString(data?.threadId))) return;
    const turn = asRecord(data?.turn);
    const turnId = asString(turn?.id);
    if (turnId && this.completedTurnIds.has(turnId)) return;
    const activeTurnId = this.activeTurnId;
    if (turnId && activeTurnId && turnId !== activeTurnId) {
      // Stale completion for a turn we no longer track; record it so the same
      // turn id can never linger as "active" state elsewhere.
      addBounded(this.completedTurnIds, turnId, MAX_TRACKED_TURN_IDS);
      return;
    }

    if (this.pendingCollabReplays.size === 0) {
      this.emitTurnCompletion(data, activeTurnId);
      return;
    }

    void this.emitTurnCompletionAfterCollabReplays(data, activeTurnId);
  }

  private async emitTurnCompletionAfterCollabReplays(
    data: JsonObject | null,
    activeTurnId: string | undefined,
  ): Promise<void> {
    await this.waitForCollabReplays();
    this.emitTurnCompletion(data, activeTurnId);
  }

  private emitTurnCompletion(data: JsonObject | null, activeTurnId: string | undefined): void {
    if (activeTurnId && this.activeTurnId !== activeTurnId) {
      // A newer turn started while we waited for collab replays; the dropped
      // completion will never be re-delivered, so record it for dedup hygiene.
      const staleTurnId = asString(asRecord(data?.turn)?.id) ?? activeTurnId;
      addBounded(this.completedTurnIds, staleTurnId, MAX_TRACKED_TURN_IDS);
      return;
    }
    const turn = asRecord(data?.turn);
    const durationMs = asNumber(turn?.durationMs);
    const status = asTurnStatus(turn?.status);
    const error = formatTurnError(turn?.error) ?? (status === "failed" ? this.lastProtocolError : undefined);
    this.resolvePendingByMethod("turn/interrupt", {});
    this.emit("result", {
      type: "result",
      session_id: this.threadId ?? "",
      duration_ms: durationMs,
      status,
      error,
      turn_id: asString(turn?.id) ?? activeTurnId,
      thread_id: this.threadId,
      usage: usageFromTokenUsage(this.lastUsage),
    });
    const completedTurnId = asString(turn?.id) ?? activeTurnId;
    if (completedTurnId) {
      addBounded(this.completedTurnIds, completedTurnId, MAX_TRACKED_TURN_IDS);
    }
    this.activeTurnId = undefined;
  }

  private async waitForCollabReplays(): Promise<void> {
    const pending = [...this.pendingCollabReplays];
    if (pending.length === 0) return;
    try {
      await withTimeout(Promise.allSettled(pending), COLLAB_THREAD_REPLAY_TIMEOUT_MS);
    } catch {
      this.emitDiagnostic({
        id: diagnosticId("codex-collab-replay", "timeout"),
        severity: "warning",
        title: "Codex sub-agent replay timed out",
        message: "Hive finished the Codex turn before all sub-agent threads could be read.",
        method: "thread/read",
        dedupeKey: "collab-replay:timeout",
      });
    }
  }

  private emitChildCommandTool(
    item: Extract<ThreadItem, { type: "commandExecution" }>,
    phase: "started" | "completed",
    parentToolUseId: string,
  ): void {
    const tool = commandExecutionActivityToToolCall({
      id: item.id,
      command: item.command ?? "",
      cwd: item.cwd,
      status: item.status,
      exitCode: asNullableNumber(item.exitCode),
      durationMs: asNullableNumber(item.durationMs),
      commandActions: normalizeAgentActivityCommandActions(item.commandActions),
      parentToolUseId,
    });
    this.emitToolUse(tool.id, tool.name, tool.input, parentToolUseId);
    if (phase === "completed") {
      this.emitToolResult(item.id, item.aggregatedOutput ?? this.commandOutputs.get(item.id) ?? formatExitCode(item.exitCode));
    }
  }

  private emitChildFileChangeTools(
    itemId: string,
    changes: FileUpdateChange[],
    status: string | undefined,
    phase: "started" | "completed",
    parentToolUseId: string,
  ): void {
    const diff = changes.map((change) => change.diff).filter(Boolean).join("\n");
    const path = changes[0]?.path ?? "";
    this.emitToolUse(itemId, "Edit", JSON.stringify({
      filename: path,
      diff,
      status,
      files: changes.map((change) => ({
        filename: change.path ?? "",
        diff: change.diff ?? "",
        kind: formatChangeKind(change.kind),
      })),
    }), parentToolUseId);
    if (phase === "completed") {
      this.emitToolResult(itemId, diff || status || "File changed");
    }
  }

  private emitPlanUpdate(data: JsonObject | null): void {
    const turnId = asString(data?.turnId) ?? this.activeTurnId ?? "unknown";
    const plan = asArray(data?.plan) ?? [];
    const items = plan
      .map((entry) => asRecord(entry))
      .filter((entry): entry is JsonObject => entry != null)
      .map((entry) => ({
        text: asString(entry.step) ?? "",
        status: asString(entry.status) ?? "pending",
      }))
      .filter((entry) => entry.text);
    if (items.length === 0) return;
    const id = `codex-plan-${turnId}`;
    this.emit("agent_event", {
      type: "plan_updated",
      id,
      steps: items,
    });
  }

  private emitGoalUpdate(data: JsonObject | null, active: boolean, source: "response" | "notification"): void {
    const goal = asRecord(data?.goal);
    const threadId = asString(goal?.threadId)
      ?? asString(data?.threadId)
      ?? asString(asRecord(data?.thread)?.id)
      ?? this.threadId;
    // A goal is scoped to a thread; without one we cannot key it stably for
    // upsert/clear, and a shared "unknown" id would collide across threads.
    if (!threadId) return;
    const event: Extract<NormalizedAgentEvent, { type: "goal_updated" }> = {
      type: "goal_updated",
      id: `codex-goal-${threadId}`,
      active,
      threadId,
      objective: asString(goal?.objective),
      status: asString(goal?.status),
      tokenBudget: asNullableProtocolNumber(goal?.tokenBudget),
      tokensUsed: asNumber(goal?.tokensUsed),
      timeUsedSeconds: asNumber(goal?.timeUsedSeconds),
      createdAt: asNumber(goal?.createdAt),
      updatedAt: asNumber(goal?.updatedAt),
    };
    const key = JSON.stringify([
      event.threadId,
      event.active,
      event.objective,
      event.status,
      event.tokenBudget,
      event.tokensUsed,
      event.timeUsedSeconds,
      event.createdAt,
      event.updatedAt,
    ], (_key, value) => value === undefined ? { __hiveType: "undefined" } : value);
    if (source === "notification") {
      if (this.pendingGoalNotificationEchoKeys.delete(key)) return;
      if (this.activeGoalRequestCount > 0) {
        this.goalNotificationKeysDuringRequest.add(key);
      }
    } else {
      if (this.goalNotificationKeysDuringRequest.delete(key)) {
        this.pendingGoalNotificationEchoKeys.add(key);
        return;
      }
      this.pendingGoalNotificationEchoKeys.add(key);
    }
    this.emit("agent_event", event);
  }

  private emitFileChangeEvents(itemId: string, changes: FileUpdateChange[], status?: string): void {
    const firstChange = changes[0];
    const files = changes
      .map((change) => ({
        path: change.path ?? "",
        diff: change.diff,
        kind: formatChangeKind(change.kind),
        status,
      }))
      .filter((change) => change.path);
    this.emit("agent_event", {
      type: "file_change_updated",
      id: itemId,
      path: firstChange?.path,
      diff: changes.map((change) => change.diff).filter(Boolean).join("\n"),
      files,
      status: status ?? (firstChange ? formatChangeKind(firstChange.kind) : undefined),
    });
  }

  private emitTextDelta(itemId: string | undefined, delta: string | undefined): void {
    if (!delta) return;
    if (itemId) this.emittedAgentText.add(itemId);
    this.emit("assistant", {
      type: "assistant",
      message: {
        id: itemId ?? `codex-text-${Date.now()}`,
        role: "assistant",
        content: [{ type: "text", text: delta }],
      },
    });
  }

  private emitThinkingDelta(itemId: string | undefined, delta: string | undefined): void {
    if (!delta) return;
    if (itemId) this.emittedReasoningText.add(itemId);
    this.emit("assistant", {
      type: "assistant",
      message: {
        id: itemId ?? `codex-thinking-${Date.now()}`,
        role: "assistant",
        content: [{ type: "thinking", thinking: delta }],
      },
    });
  }

  private emitToolUse(id: string, name: string, input: string, parentToolUseId?: string): void {
    if (parentToolUseId) this.toolParentByItemId.set(id, parentToolUseId);
    if (this.emittedToolIds.has(id)) return;
    this.emittedToolIds.add(id);
    this.emit("assistant", {
      type: "assistant",
      message: {
        id,
        role: "assistant",
        content: [{ type: "tool_use", id, name, input, ...(parentToolUseId ? { parentToolUseId } : {}) }],
      },
    });
  }

  private emitToolResult(id: string, output: string): void {
    if (this.completedToolIds.has(id)) return;
    this.completedToolIds.add(id);
    this.emit("user", {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: output }],
      },
    });
  }

  private resolvePendingByMethod(method: string, result: unknown): void {
    this.rpc?.resolvePendingByMethod(method, result);
  }

  private onRpcClosed(err: Error): void {
    if (this.activeTurnId) {
      this.emit("error", err);
    }
    this.rpc = null;
    this.initialized = null;
    this.activeTurnId = undefined;
    this.threadId = undefined;
    this.resetForThreadBoundary();
  }
}

function asRecord(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" ? value as JsonObject : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asNullableProtocolNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return asNumber(value);
}

function asNullableNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asTurnStatus(value: unknown): TurnStatus {
  if (value === "completed" || value === "interrupted" || value === "failed" || value === "inProgress") {
    return value;
  }
  return "failed";
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function notificationStatus(data: JsonObject | null): string | undefined {
  return (
    asString(data?.status) ??
    asString(asRecord(data?.thread)?.status) ??
    asString(asRecord(data?.startupStatus)?.status) ??
    asString(asRecord(data?.startupStatus)?.state)
  );
}

function isNotificationStatus(data: JsonObject | null, ...statuses: string[]): boolean {
  const status = notificationStatus(data);
  return status !== undefined && statuses.includes(status);
}

function formatTurnError(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const message = asString(record.message);
  const additionalDetails = asString(record.additionalDetails);
  if (message && additionalDetails) return `${message}: ${additionalDetails}`;
  return message ?? additionalDetails;
}

function formatErrorNotification(data: JsonObject | null): string {
  const error = asRecord(data?.error);
  return (
    formatTurnError(error) ??
    asString(data?.message) ??
    asString(error?.message) ??
    "Codex app-server error"
  );
}

function usageFromTokenUsage(value: TokenUsage | undefined): {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  context_used_tokens?: number;
  context_window?: number;
} | undefined {
  const usage = value?.last ?? value?.total;
  if (!usage) return undefined;
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    cache_read_input_tokens: usage.cachedInputTokens,
    context_used_tokens: usage.totalTokens,
    context_window: value?.modelContextWindow ?? undefined,
  };
}

/**
 * Resolve an App Server absolute image path against the current turn cwd.
 * Inside the workspace -> repo-relative path usable with the raw-file API
 * (which enforces repo safety); outside -> flagged so the UI never builds a
 * preview URL for arbitrary disk paths. Unknown cwd -> neither.
 */
function relativizeWorkspacePath(
  path: string,
  cwd: string | undefined,
): { relativePath?: string; outsideWorkspace?: boolean } {
  if (!cwd) return {};
  const relativePath = relative(resolve(cwd), resolve(path));
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return { outsideWorkspace: true };
  }
  return { relativePath };
}

function formatExitCode(exitCode: number | null | undefined): string {
  return exitCode == null ? "" : `Exit code: ${exitCode}`;
}

function formatChangeKind(kind: unknown): string {
  if (typeof kind === "string") return kind;
  const record = asRecord(kind);
  const type = asString(record?.type);
  return type ?? "update";
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function collabAgentToolInput(item: CollabToolCallItem): JsonObject {
  return {
    subagent_type: collabAgentLabel(item),
    description: collabAgentDescription(item),
    prompt: item.prompt ?? undefined,
    run_in_background: true,
    model: item.model ?? undefined,
    reasoning_effort: item.reasoningEffort ?? undefined,
    tool: item.tool,
    status: item.status,
    sender_thread_id: item.senderThreadId,
    receiver_thread_ids: collabAgentReceiverThreadIds(item),
    agents_states: item.agentsStates,
  };
}

function collabAgentReceiverThreadIds(item: CollabToolCallItem): string[] {
  return [
    ...(item.receiverThreadIds ?? []),
    item.receiverThreadId,
    item.newThreadId,
  ].filter((threadId): threadId is string => Boolean(threadId));
}

function collabAgentDescription(item: CollabToolCallItem): string {
  const prompt = item.prompt?.trim().split("\n").find((line) => line.trim());
  if (prompt) return prompt.trim();
  return item.tool === "spawnAgent" ? "Agent" : "";
}

function collabAgentLabel(item: CollabToolCallItem): string {
  return item.tool === "spawnAgent" ? "Agent" : formatCollabAgentTool(item.tool);
}

function collabAgentToolResult(item: CollabToolCallItem): string {
  return JSON.stringify([{
    type: "text",
    text: formatUnknown({
      tool: item.tool,
      status: item.status,
      receiverThreadIds: collabAgentReceiverThreadIds(item),
      agentsStates: item.agentsStates,
    }),
  }]);
}

function formatCollabAgentTool(tool: string | undefined): string {
  if (!tool) return "Agent";
  return tool
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timeout);
        reject(err);
      },
    );
  });
}

/** Both variants mean the child thread is too young to be read: it was created
 *  but has not run (or Codex has not flushed its rollout to disk) yet. Nothing
 *  to catch up — not worth a user-facing warning. */
function isUnmaterializedThreadReadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    (message.includes("not materialized yet") &&
      message.includes("includeTurns is unavailable before first user message")) ||
    (message.includes("rollout") && message.includes("is empty"))
  );
}

function diagnosticId(prefix: string, method: string): string {
  const safeMethod = method.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  return `${prefix}-${safeMethod || "unknown"}`;
}

function diagnosticMessage(data: JsonObject | null, fallback: string): string {
  return (
    asString(data?.message) ??
    asString(data?.warning) ??
    asString(data?.text) ??
    asString(data?.title) ??
    fallback
  );
}

function formatDiagnosticDetails(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const formatted = formatUnknown(redactSensitiveValues(value));
  if (formatted.length <= MAX_DIAGNOSTIC_DETAILS_LENGTH) return formatted;
  return `${formatted.slice(0, MAX_DIAGNOSTIC_DETAILS_LENGTH - 1)}…`;
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveValues(entry));
  }
  const record = asRecord(value);
  if (!record) return value;

  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => {
      if (/token|secret|password|authorization|api[_-]?key/i.test(key)) {
        return [key, "[redacted]"];
      }
      return [key, redactSensitiveValues(entry)];
    }),
  );
}
