// Shared types for the install/setup flow. Consumed by backend (API + engine)
// and frontend (wizard). See docs/install-flow-implementation-plan.md §3.

import type { SetupErrorCode } from "./setup-errors.js";

export const SETUP_PROTOCOL_VERSION = 1;

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
  attempts: number;
  exitCode?: number;
  /** [firstSeq, lastSeq] range of this step's lines in the operation log. */
  logRange?: [number, number];
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

export type SetupOperationKind = "guided-setup" | "self-update";

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
  heartbeatAt: string;
  finishedAt?: string;
}

/** One line of an operation log (also the wire format for /log?since=). */
export interface SetupLogLine {
  seq: number;
  ts: string;
  stepId: string;
  stream: "stdout" | "stderr" | "system";
  line: string;
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
  latestVersion?: string;
  updateAvailable?: boolean;
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

export interface VersionResponse {
  version: string;
  protocolVersion: number;
  commit?: string;
}

// --- iOS pairing payload (QR) ---

export interface PairingPayload {
  v: number;
  host: string;
  port: number;
  token: string;
  name?: string;
}
