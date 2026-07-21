// Shared types for the install/setup flow. Consumed by backend (API + engine)
// and frontend (wizard).

import type { SetupErrorCode } from "./setup-errors.js";

export type SetupStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface SetupStepError {
  code: SetupErrorCode;
  message: string;
  hint?: string;
}

export interface SetupStep {
  id: string;
  title: string;
  status: SetupStepStatus;
  exitCode?: number;
  error?: SetupStepError;
  startedAt?: string;
  finishedAt?: string;
  /** Structured result emitted by the step (e.g. { nodeVersion }). */
  data?: Record<string, unknown>;
  /** Interactive action the client must surface (device-code / OAuth URL flows). */
  action?: SetupStepAction;
}

export type SetupStepAction =
  | { kind: "open_url"; url: string }
  | { kind: "open_url_with_code"; url: string; code: string; expiresAt?: string };

export type SetupOperationKind = "guided-setup";

export type SetupOperationStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed";

export interface SetupOperation {
  id: string;
  kind: SetupOperationKind;
  status: SetupOperationStatus;
  steps: SetupStep[];
  startedAt: string;
  finishedAt?: string;
}

// --- Detection ---

export type DetectableTool =
  | "claude"
  | "codex"
  | "gh"
  | "tailscale"
  | "node"
  | "docker";

export interface ToolDetection {
  installed: boolean;
  /** Whether the tool is authenticated where that concept applies (claude/codex/gh/tailscale). */
  authenticated?: boolean;
  version?: string;
}

export interface SetupStatus {
  detected: Partial<Record<DetectableTool, ToolDetection>>;
  operations: SetupOperation[];
}

// --- Requests ---

export interface RunSetupRequest {
  steps: string[];
  options?: Record<string, unknown>;
}

export interface RunSetupResponse {
  operationId: string;
}
