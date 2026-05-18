import type { EventEmitter } from "node:events";
import type { StreamParserEvent } from "../stream-parser.js";

export type StopReason = "user" | "park";

export type RunnerStderrEvent = {
  text: string;
  classification: "diagnostic" | "error";
};

export type AgentRunnerEvent = StreamParserEvent & {
  stderr: [event: RunnerStderrEvent];
  exit: [code: number, providerSessionId?: string];
};

export type AgentRunner = EventEmitter<AgentRunnerEvent> & {
  start(): void;
  stop(reason: StopReason): void;
  forceKill?(): boolean;
  close?(): void;
};
