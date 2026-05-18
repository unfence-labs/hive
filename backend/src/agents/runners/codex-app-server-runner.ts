import { EventEmitter } from "node:events";
import { CodexAppServerSession } from "../providers/codex-app-server.js";
import type { ThinkingLevel } from "../providers/types.js";
import type { AgentRunner, AgentRunnerEvent, StopReason } from "./types.js";

interface CodexAppServerRunnerTurn {
  cwd: string;
  content: string;
  imagePaths?: string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  systemPrompt?: string;
  threadId?: string;
  env?: Record<string, string>;
}

export class CodexAppServerRunner extends EventEmitter<AgentRunnerEvent> implements AgentRunner {
  private readonly appServer = new CodexAppServerSession();
  private interruptTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.appServer.on("assistant", (data) => this.emit("assistant", data));
    this.appServer.on("user", (data) => this.emit("user", data));
    this.appServer.on("result", (data) => this.emit("result", data));
    this.appServer.on("system", (data) => this.emit("system", data));
    this.appServer.on("error", (err) => this.emit("error", err));
  }

  get capturedTurnId(): string | undefined {
    return this.appServer.capturedTurnId;
  }

  startTurn(turn: CodexAppServerRunnerTurn): void {
    this.clearInterruptTimer();
    void this.appServer.startTurn(turn).catch((err: unknown) => {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    });
  }

  start(): void {
    // App Server turns require startTurn() because each turn has structured options.
  }

  stop(reason: StopReason): void {
    const turnId = this.appServer.capturedTurnId;
    this.clearInterruptTimer();
    if (!turnId) {
      this.close();
      return;
    }

    this.appServer.interruptActiveTurn();
    if (reason === "park") {
      this.close();
      return;
    }

    this.interruptTimer = setTimeout(() => {
      this.interruptTimer = null;
      if (this.appServer.capturedTurnId === turnId) {
        this.close();
      }
    }, 5000);
  }

  close(): void {
    this.clearInterruptTimer();
    this.appServer.close();
  }

  private clearInterruptTimer(): void {
    if (!this.interruptTimer) return;
    clearTimeout(this.interruptTimer);
    this.interruptTimer = null;
  }
}
