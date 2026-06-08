import type { EventEmitter } from "node:events";
import type { NormalizedAgentEvent } from "../agent-event-normalizer.js";
import type { StreamParserEvent } from "../stream-parser.js";

export type StopReason = "user" | "park";

export type RunnerStderrEvent = {
  text: string;
  classification: "diagnostic" | "error";
};

export type AgentRunnerTurnStartedEvent = {
  threadId?: string;
  turnId?: string;
};

export type AgentRunnerEvent = StreamParserEvent & {
  agent_event: [event: NormalizedAgentEvent];
  turn_started: [event: AgentRunnerTurnStartedEvent];
  stderr: [event: RunnerStderrEvent];
  exit: [code: number, providerSessionId?: string];
};

export type AgentRunner = EventEmitter<AgentRunnerEvent> & {
  start(): void;
  stop(reason: StopReason): void;
  forceKill?(): boolean;
  close?(): void;
};
