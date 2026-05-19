import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import type { NormalizedAgentEvent } from "../agent-event-normalizer.js";
import type { StreamParserEvent } from "../stream-parser.js";
import type { ThinkingLevel } from "./types.js";
import { buildWorkspaceEnv } from "../../utils/env.js";

type JsonObject = Record<string, unknown>;
type JsonRpcId = number;

interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcRequest | JsonRpcNotification;

type CodexAppServerEvent = StreamParserEvent & {
  agent_event: [event: NormalizedAgentEvent];
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

type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

type TokenUsage = {
  total?: TokenBreakdown;
  last?: TokenBreakdown;
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
  | {
      type: "collabAgentToolCall";
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
    }
  | { type: "webSearch"; id: string; query?: string; action?: unknown }
  | { type: string; id?: string; [key: string]: unknown };

type FileUpdateChange = {
  path?: string;
  diff?: string;
  kind?: unknown;
};

interface CodexAppServerTurnOptions {
  cwd: string;
  content: string;
  imagePaths?: string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt?: string;
  threadId?: string;
  env?: Record<string, string>;
}

const CLIENT_INFO = {
  name: "hive",
  title: "Hive",
  version: "0.1.0",
};
const MAX_DIAGNOSTIC_DETAILS_LENGTH = 4000;
const COLLAB_THREAD_REPLAY_TIMEOUT_MS = 1500;

/**
 * Per-chat-session bridge to `codex app-server`.
 *
 * The generated App Server schema is very large and changes with the installed
 * Codex version, so this bridge keeps a deliberately small typed surface for the
 * protocol fields Hive consumes and leaves unknown fields untouched.
 */
export class CodexAppServerSession extends EventEmitter<CodexAppServerEvent> {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private initialized: Promise<void> | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, {
    method: string;
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
  }>();
  private threadId: string | undefined;
  private activeTurnId: string | undefined;
  private emittedToolIds = new Set<string>();
  private commandOutputs = new Map<string, string>();
  private fileChanges = new Map<string, FileUpdateChange[]>();
  private emittedAgentText = new Set<string>();
  private emittedReasoningText = new Set<string>();
  private emittedDiagnostics = new Set<string>();
  private completedToolIds = new Set<string>();
  private collabParentByThreadId = new Map<string, string>();
  private toolParentByItemId = new Map<string, string>();
  private pendingCollabReplays = new Set<Promise<void>>();
  private lastUsage: TokenUsage | undefined;
  private lastProtocolError: string | undefined;

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
    this.resetTurnState();
    this.threadId = await this.ensureThread(options);
    const input: UserInput[] = [
      { type: "text", text: options.content, text_elements: [] },
      ...(options.imagePaths ?? []).map((path) => ({ type: "localImage" as const, path })),
    ];
    const response = await this.request<TurnStartResponse>("turn/start", {
      threadId: this.threadId,
      input,
      cwd: options.cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      ...(options.model ? { model: options.model } : {}),
      ...(options.thinkingLevel ? { effort: options.thinkingLevel } : {}),
    });
    this.activeTurnId = response.turn.id;
  }

  interruptActiveTurn(): void {
    if (!this.threadId || !this.activeTurnId) return;
    void this.request("turn/interrupt", {
      threadId: this.threadId,
      turnId: this.activeTurnId,
    }).catch((err) => this.emit("error", err));
  }

  close(): void {
    const hadActiveTurn = Boolean(this.activeTurnId);
    for (const { reject } of this.pending.values()) {
      reject(new Error("Codex app-server closed"));
    }
    this.pending.clear();
    this.proc?.kill("SIGTERM");
    this.proc = null;
    this.initialized = null;
    this.activeTurnId = undefined;
    if (hadActiveTurn) {
      queueMicrotask(() => this.emit("error", new Error("Codex app-server closed")));
    }
  }

  private async ensureInitialized(env: Record<string, string> | undefined): Promise<void> {
    if (this.initialized) return this.initialized;
    this.initialized = (async () => {
      this.proc = spawn("codex", ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildWorkspaceEnv(env),
      });
      this.proc.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk.toString("utf-8")));
      this.proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8").trim();
        if (text) this.emit("system", { type: "system", message: text, level: "debug" });
      });
      this.proc.on("error", (err) => this.rejectAll(err));
      this.proc.on("close", (code) => {
        this.rejectAll(new Error(`Codex app-server exited with code ${code ?? 1}`));
      });

      await this.request("initialize", {
        clientInfo: CLIENT_INFO,
        capabilities: { experimentalApi: true },
      });
      this.notify("initialized");
    })();
    return this.initialized;
  }

  private async ensureThread(options: CodexAppServerTurnOptions): Promise<string> {
    if (options.threadId) {
      const resumed = await this.request<ThreadResumeResponse>("thread/resume", {
        threadId: options.threadId,
        cwd: options.cwd,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        ...(options.model ? { model: options.model } : {}),
        ...(options.systemPrompt ? { developerInstructions: options.systemPrompt } : {}),
      });
      return resumed.thread.id;
    }

    if (this.threadId) return this.threadId;

    const started = await this.request<ThreadStartResponse>("thread/start", {
      cwd: options.cwd,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ...(options.model ? { model: options.model } : {}),
      ...(options.systemPrompt ? { developerInstructions: options.systemPrompt } : {}),
    });
    return started.thread.id;
  }

  private resetTurnState(): void {
    this.activeTurnId = undefined;
    this.emittedToolIds.clear();
    this.commandOutputs.clear();
    this.fileChanges.clear();
    this.emittedAgentText.clear();
    this.emittedReasoningText.clear();
    this.emittedDiagnostics.clear();
    this.completedToolIds.clear();
    this.collabParentByThreadId.clear();
    this.toolParentByItemId.clear();
    this.pendingCollabReplays.clear();
    this.lastUsage = undefined;
    this.lastProtocolError = undefined;
  }

  private request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const proc = this.proc;
    if (!proc || !proc.stdin.writable) {
      return Promise.reject(new Error("Codex app-server is not running"));
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = { id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
      });
      proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  private notify(method: string, params?: unknown): void {
    this.proc?.stdin.write(`${JSON.stringify({ method, ...(params !== undefined ? { params } : {}) })}\n`);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.handleMessage(trimmed);
    }
  }

  private handleMessage(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit("error", new Error(`Malformed Codex app-server JSON line: ${line.slice(0, 200)}`));
      return;
    }

    if ("id" in message && "method" in message) {
      this.handleServerRequest(message);
      return;
    }

    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if ("error" in message && message.error) {
        pending.reject(new Error(message.error.message ?? `${pending.method} failed`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ("method" in message) {
      this.handleNotification(message.method, message.params);
    }
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
    this.proc?.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  private respondError(id: JsonRpcId, message: string): void {
    this.proc?.stdin.write(`${JSON.stringify({ id, error: { code: -32603, message } })}\n`);
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
        this.threadId = asString(asRecord(data?.thread)?.id) ?? this.threadId;
        break;
      case "turn/started": {
        const turn = asRecord(data?.turn);
        this.activeTurnId = asString(turn?.id) ?? this.activeTurnId;
        break;
      }
      case "thread/tokenUsage/updated":
        this.lastUsage = asRecord(data?.tokenUsage) as TokenUsage | undefined;
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
        this.emitPlanUpdate(data);
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
        void this.emitTurnCompletionAfterCollabReplays(data);
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
        this.emitDiagnostic({
          id: diagnosticId("codex-notification", method),
          severity: "info",
          title: "Unsupported App Server event",
          message: `Hive does not render "${method}" yet.`,
          method,
          details: formatDiagnosticDetails(params),
          dedupeKey: `notification:${method}`,
        });
        break;
    }
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
      case "collabAgentToolCall": {
        const collabItem = item as Extract<ThreadItem, { type: "collabAgentToolCall" }>;
        if (parentToolUseId && this.isCollabAgentSelfReference(collabItem, context.threadId)) {
          break;
        }
        this.rememberCollabAgentReceivers(collabItem);
        this.emitToolUse(collabItem.id, "Agent", JSON.stringify(collabAgentToolInput(collabItem)), parentToolUseId);
        if (phase === "completed") {
          this.emitToolResult(collabItem.id, collabAgentToolResult(collabItem));
          this.queueCollabAgentReplay(collabItem);
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
    item: Extract<ThreadItem, { type: "collabAgentToolCall" }>,
    threadId: string | undefined,
  ): boolean {
    return Boolean(threadId && collabAgentReceiverThreadIds(item).includes(threadId));
  }

  private parentToolUseIdForThread(threadId: string | undefined): string | undefined {
    return threadId ? this.collabParentByThreadId.get(threadId) : undefined;
  }

  private rememberCollabAgentReceivers(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): void {
    for (const threadId of collabAgentReceiverThreadIds(item)) {
      this.collabParentByThreadId.set(threadId, item.id);
    }
  }

  private queueCollabAgentReplay(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): void {
    const threadIds = collabAgentReceiverThreadIds(item);
    if (threadIds.length === 0) return;
    const replay = Promise.all(threadIds.map((threadId) => this.replayCollabAgentThread(threadId, item.id)))
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

  private async emitTurnCompletionAfterCollabReplays(data: JsonObject | null): Promise<void> {
    await this.waitForCollabReplays();
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
      usage: usageFromTokenUsage(this.lastUsage),
    });
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
    this.emitToolUse(item.id, "Bash", JSON.stringify({
      command: item.command ?? "",
      cwd: item.cwd,
      status: item.status,
      exitCode: asNullableNumber(item.exitCode),
      durationMs: asNullableNumber(item.durationMs),
    }), parentToolUseId);
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
    for (const [id, pending] of this.pending) {
      if (pending.method !== method) continue;
      this.pending.delete(id);
      pending.resolve(result);
    }
  }

  private rejectAll(err: Error): void {
    for (const { reject } of this.pending.values()) {
      reject(err);
    }
    this.pending.clear();
    if (this.activeTurnId) {
      this.emit("error", err);
    }
    this.proc = null;
    this.initialized = null;
    this.activeTurnId = undefined;
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
} | undefined {
  const usage = value?.last ?? value?.total;
  if (!usage) return undefined;
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    cache_read_input_tokens: usage.cachedInputTokens,
  };
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

function collabAgentToolInput(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): JsonObject {
  return {
    subagent_type: "Agent",
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

function collabAgentReceiverThreadIds(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): string[] {
  return [
    ...(item.receiverThreadIds ?? []),
    item.receiverThreadId,
    item.newThreadId,
  ].filter((threadId): threadId is string => Boolean(threadId));
}

function collabAgentDescription(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): string {
  const prompt = item.prompt?.trim().split("\n").find((line) => line.trim());
  return prompt?.trim() || formatCollabAgentTool(item.tool);
}

function collabAgentToolResult(item: Extract<ThreadItem, { type: "collabAgentToolCall" }>): string {
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

function isUnmaterializedThreadReadError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("not materialized yet") &&
    message.includes("includeTurns is unavailable before first user message");
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
