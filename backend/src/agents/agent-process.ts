import * as pty from "node-pty";
import { createWriteStream, type WriteStream } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AgentProcessConfig {
  cwd: string;
  prompt: string;
  logFile: string;
  command?: string;
  args?: string[];
}

export type AgentProcessEvent = {
  data: [chunk: string];
  exit: [code: number];
  error: [err: Error];
};

export class AgentProcess extends EventEmitter<AgentProcessEvent> {
  private ptyProcess: pty.IPty | null = null;
  private logStream: WriteStream | null = null;
  private _status: "idle" | "running" | "done" | "error" = "idle";
  private _exitCode?: number;
  readonly config: AgentProcessConfig;

  constructor(config: AgentProcessConfig) {
    super();
    this.config = config;
  }

  get status() {
    return this._status;
  }

  get exitCode() {
    return this._exitCode;
  }

  async start(): Promise<void> {
    if (this._status === "running") throw new Error("Already running");

    await mkdir(dirname(this.config.logFile), { recursive: true });
    this.logStream = createWriteStream(this.config.logFile, { flags: "a" });

    const cmd = this.config.command ?? "claude";
    const args = this.config.args ?? [
      "-p", this.config.prompt,
      "--dangerously-skip-permissions",
    ];

    try {
      this.ptyProcess = pty.spawn(cmd, args, {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: this.config.cwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      this._status = "error";
      this.logStream?.end();
      this.logStream = null;
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      return;
    }

    this._status = "running";

    this.ptyProcess.onData((data: string) => {
      this.logStream?.write(data);
      this.emit("data", data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this._exitCode = exitCode;
      this._status = exitCode === 0 ? "done" : "error";
      this.logStream?.end();
      this.logStream = null;
      this.ptyProcess = null;
      this.emit("exit", exitCode);
    });
  }

  stop(): void {
    if (!this.ptyProcess) return;

    this.ptyProcess.kill("SIGTERM");

    // Force kill after 5 seconds
    const forceKillTimer = setTimeout(() => {
      try {
        this.ptyProcess?.kill("SIGKILL");
      } catch {
        // Already exited
      }
    }, 5000);

    const cleanup = () => clearTimeout(forceKillTimer);
    this.once("exit", cleanup);
  }
}
