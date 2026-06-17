import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { StreamAdapter } from "../providers/types.js";
import { buildWorkspaceEnv } from "../../utils/env.js";
import type { AgentRunner, AgentRunnerEvent, StopReason } from "./types.js";

interface ProcessAgentRunnerConfig {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  parser: StreamAdapter;
  useWorkspaceEnv: boolean;
}

export class ProcessAgentRunner extends EventEmitter<AgentRunnerEvent> implements AgentRunner {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string> | undefined;
  private readonly parser: StreamAdapter;
  private readonly useWorkspaceEnv: boolean;
  private process: ChildProcess | null = null;

  constructor(config: ProcessAgentRunnerConfig) {
    super();
    this.command = config.command;
    this.args = config.args;
    this.cwd = config.cwd;
    this.env = config.env;
    this.parser = config.parser;
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

    this.process.stdin?.end();

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.parser.write(chunk.toString("utf-8"));
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8").trim();
      if (!text) return;
      this.emit("stderr", { text });
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

function capturedProviderSessionId(parser: StreamAdapter): string | undefined {
  const maybe = parser as StreamAdapter & { capturedSessionId?: string };
  return maybe.capturedSessionId;
}
