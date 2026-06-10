import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

export type JsonRpcId = number;
export type JsonObject = Record<string, unknown>;

export interface JsonRpcResponse {
  id: JsonRpcId;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcResponse | JsonRpcRequest | JsonRpcNotification;

type JsonRpcStdioClientEvent = {
  request: [request: JsonRpcRequest];
  notification: [notification: JsonRpcNotification];
  stderr: [text: string];
  error: [err: Error];
  close: [err: Error];
};

interface PendingRequest {
  method: string;
  timer: NodeJS.Timeout | null;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface JsonRpcStdioClientOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  closeOnRequestTimeout?: boolean;
}

export class JsonRpcStdioClient extends EventEmitter<JsonRpcStdioClientEvent> {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();

  constructor(private readonly options: JsonRpcStdioClientOptions) {
    super();
  }

  start(): void {
    if (this.proc) return;
    this.proc = spawn(this.options.command, this.options.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.options.env,
    });
    this.proc.stdout.on("data", (chunk: Buffer) => this.onStdout(chunk.toString("utf-8")));
    this.proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (text) this.emit("stderr", text);
    });
    this.proc.on("error", (err) => this.closeWithError(err));
    this.proc.on("close", (code) => {
      this.closeWithError(new Error(`${this.options.command} exited with code ${code ?? 1}`), false);
    });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const proc = this.proc;
    if (!proc || !proc.stdin.writable) {
      return Promise.reject(new Error(`${this.options.command} is not running`));
    }

    const id = this.nextId++;
    const payload: JsonRpcRequest = { id, method, ...(params !== undefined ? { params } : {}) };
    return new Promise<T>((resolve, reject) => {
      const pending: PendingRequest = {
        method,
        timer: null,
        resolve: (value) => resolve(value as T),
        reject,
      };
      if (this.options.requestTimeoutMs) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          const err = new Error(`${method} timed out`);
          reject(err);
          if (this.options.closeOnRequestTimeout) {
            this.close(err);
          }
        }, this.options.requestTimeoutMs);
      }
      this.pending.set(id, pending);
      proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  notify(method: string, params?: unknown): void {
    this.proc?.stdin.write(`${JSON.stringify({ method, ...(params !== undefined ? { params } : {}) })}\n`);
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.proc?.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id: JsonRpcId, message: string): void {
    this.proc?.stdin.write(`${JSON.stringify({ id, error: { code: -32603, message } })}\n`);
  }

  resolvePendingByMethod(method: string, result: unknown): void {
    for (const [id, pending] of this.pending) {
      if (pending.method !== method) continue;
      this.pending.delete(id);
      this.clearPendingTimer(pending);
      pending.resolve(result);
    }
  }

  close(err = new Error(`${this.options.command} closed`)): void {
    this.closeWithError(err, true);
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.handleLine(trimmed);
    }
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.emit("error", new Error(`Malformed JSON-RPC line: ${line.slice(0, 200)}`));
      return;
    }

    if ("id" in message && "method" in message) {
      this.emit("request", message);
      return;
    }

    if ("id" in message) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      this.clearPendingTimer(pending);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? `${pending.method} failed`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if ("method" in message) {
      this.emit("notification", message);
    }
  }

  private closeWithError(err: Error, killProcess = true): void {
    const proc = this.proc;
    if (!proc && this.pending.size === 0) return;
    this.proc = null;
    this.buffer = "";
    for (const pending of this.pending.values()) {
      this.clearPendingTimer(pending);
      pending.reject(err);
    }
    this.pending.clear();
    if (killProcess) {
      proc?.kill("SIGTERM");
    }
    this.emit("close", err);
  }

  private clearPendingTimer(pending: PendingRequest): void {
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }
  }
}
