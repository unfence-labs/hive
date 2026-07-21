import type { SetupErrorCode } from "./setup-errors.js";

export type SetupStepStatus = "pending" | "running" | "succeeded" | "failed";

export interface SetupStepError {
  code: SetupErrorCode;
  message: string;
  detail?: string;
}

export type SetupStepAction = {
  kind: "open_url_with_code";
  url: string;
  code: string;
};

export interface SetupStep {
  id: string;
  title: string;
  status: SetupStepStatus;
  error?: SetupStepError;
  action?: SetupStepAction;
}

export type SetupOperationStatus = "running" | "succeeded" | "failed";

export interface SetupOperation {
  id: string;
  status: SetupOperationStatus;
  steps: SetupStep[];
  startedAt: string;
  finishedAt?: string;
}

export type DetectableTool = "claude" | "codex" | "gh";

export interface ToolDetection {
  installed: boolean;
  authenticated: boolean;
}

export interface SetupStatus {
  detected: Record<DetectableTool, ToolDetection>;
}

export interface RunSetupRequest {
  steps: string[];
}

export interface RunSetupResponse {
  operationId: string;
}
