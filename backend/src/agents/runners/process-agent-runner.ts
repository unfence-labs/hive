import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { StreamAdapter } from "../providers/types.js";
import { buildWorkspaceEnv } from "../../utils/env.js";
import type { AgentRunner, AgentRunnerEvent, StopReason } from "./types.js";

/** Gemini CLI writes informational/retry messages to stderr; suppress these from error events. */
const GEMINI_STDERR_NOISE = [
  "Loaded cached credentials",
  "YOLO mode is enabled",
  "Retrying with backoff",
  "GaxiosError",
];

/** Codex CLI writes non-fatal operational diagnostics to stderr. */
const CODEX_STDERR_NOISE = [
  "Reading additional input from stdin",
];

const CODEX_STDERR_NOISE_PATTERNS = [
  /\bERROR\s+codex_core::tools::router:\s+error=resources\/(?:templates\/)?list failed: unknown MCP server '[^']+'/,
];

const CODEX_STDERR_DIAGNOSTIC_PATTERNS = [
  /failed to connect to websocket: UTF-8 encoding error: failed to convert header to a str for header name 'x-codex-turn-metadata'/,
  /stream disconnected before completion: UTF-8 encoding error: failed to convert header to a str for header name 'x-codex-turn-metadata'/,
];

interface ProcessAgentRunnerConfig {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  stdinContent?: string;
  parser: StreamAdapter;
  providerId?: string;
  useWorkspaceEnv: boolean;
}

export class ProcessAgentRunner extends EventEmitter<AgentRunnerEvent> implements AgentRunner {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string> | undefined;
  private readonly stdinContent: string | undefined;
  private readonly parser: StreamAdapter;
  private readonly providerId: string | undefined;
  private readonly useWorkspaceEnv: boolean;
  private process: ChildProcess | null = null;

  constructor(config: ProcessAgentRunnerConfig) {
    super();
    this.command = config.command;
    this.args = config.args;
    this.cwd = config.cwd;
    this.env = config.env;
    this.stdinContent = config.stdinContent;
    this.parser = config.parser;
    this.providerId = config.providerId;
    this.useWorkspaceEnv = config.useWorkspaceEnv;

    this.parser.on("assistant", (data) => this.emit("assistant", data));
    this.parser.on("user", (data) => this.emit("user", data));
    this.parser.on("result", (data) => this.emit("result", data));
    this.parser.on("system", (data) => this.emit("system", data));
    this.parser.on("error", (err) => this.emit("error", err));
  }

  start(): void {
    this.process = spawn(this.command, this.args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      ...(this.useWorkspaceEnv ? { env: buildWorkspaceEnv(this.env) } : {}),
    });

    this.process.stdin?.end(this.stdinContent);

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.parser.write(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (!text) return;
      const classification = classifyProviderStderr(this.providerId, text);
      if (classification === "suppress") return;
      this.emit("stderr", { text, classification });
    });

    this.process.on("error", (err) => {
      this.process = null;
      this.emit("error", err);
    });

    this.process.on("close", (code) => {
      this.parser.flush();
      const providerSessionId = capturedProviderSessionId(this.parser);
      this.process = null;
      this.emit("exit", code ?? 1, providerSessionId);
    });
  }

  stop(_reason: StopReason): void {
    if (!this.process) {
      this.emit("exit", 0);
      return;
    }

    this.process.kill("SIGTERM");

    const timer = setTimeout(() => {
      try {
        this.process?.kill("SIGKILL");
      } catch {
        // Already exited.
      }
    }, 5000);

    this.process.on("close", () => clearTimeout(timer));
  }

  forceKill(): boolean {
    return this.process?.kill("SIGKILL") ?? false;
  }
}

function classifyProviderStderr(providerId: string | undefined, text: string): "suppress" | "diagnostic" | "error" {
  if (providerId === "gemini") {
    return GEMINI_STDERR_NOISE.some((n) => text.includes(n)) ? "suppress" : "error";
  }

  if (providerId === "codex") {
    if (CODEX_STDERR_NOISE.some((n) => text.includes(n))
      || CODEX_STDERR_NOISE_PATTERNS.some((pattern) => pattern.test(text))) {
      return "suppress";
    }
    if (CODEX_STDERR_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(text))) {
      return "diagnostic";
    }
  }

  return "error";
}

function capturedProviderSessionId(parser: StreamAdapter): string | undefined {
  const maybe = parser as StreamAdapter & {
    capturedThreadId?: string;
    capturedSessionId?: string;
  };
  return maybe.capturedThreadId ?? maybe.capturedSessionId;
}
