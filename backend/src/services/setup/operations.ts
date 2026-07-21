import { nanoid } from "nanoid";
import type {
  SetupOperation,
  SetupStepAction,
} from "@hive/shared/setup-types";
import type { SetupErrorCode } from "@hive/shared/setup-errors";

const DEFAULT_RETENTION_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_OPERATIONS = 50;

export interface StepContext {
  setAction: (action: SetupStepAction) => void;
}

export type StepFn = (ctx: StepContext) => Promise<void>;

export interface RunnableStep {
  id: string;
  title: string;
  fn: StepFn;
}

export class StepError extends Error {
  readonly code: SetupErrorCode;
  readonly detail?: string;

  constructor(code: SetupErrorCode, message: string, opts?: { detail?: string }) {
    super(message);
    this.name = "StepError";
    this.code = code;
    this.detail = opts?.detail;
  }
}

export class ConcurrentOperationError extends Error {
  readonly existingOperationId: string;

  constructor(existingOperationId: string) {
    super("A setup operation with an overlapping step is already running");
    this.name = "ConcurrentOperationError";
    this.existingOperationId = existingOperationId;
  }
}

export interface SetupOperationRunner {
  start: (steps: RunnableStep[]) => SetupOperation;
  get: (id: string) => SetupOperation | null;
}

interface RunnerOptions {
  now?: () => number;
  idGenerator?: () => string;
  retentionMs?: number;
  maxOperations?: number;
  onUnexpectedError?: (operationId: string, error: unknown) => void;
}

function copyOperation(operation: SetupOperation): SetupOperation {
  return structuredClone(operation);
}

function toStepError(error: unknown): StepError {
  if (error instanceof StepError) return error;
  return new StepError(
    "UNKNOWN",
    error instanceof Error ? error.message : String(error),
  );
}

/**
 * Creates an in-process setup runner. Operations intentionally do not survive
 * backend restarts: installer guards make starting the same steps again safe.
 */
export function createSetupOperationRunner(
  options: RunnerOptions = {},
): SetupOperationRunner {
  const operations = new Map<string, SetupOperation>();
  const now = options.now ?? Date.now;
  const idGenerator = options.idGenerator ?? (() => nanoid(8));
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const maxOperations = options.maxOperations ?? DEFAULT_MAX_OPERATIONS;

  function prune(maxSize = maxOperations): void {
    const cutoff = now() - retentionMs;
    for (const [id, operation] of operations) {
      if (
        operation.status !== "running" &&
        operation.finishedAt &&
        Date.parse(operation.finishedAt) <= cutoff
      ) {
        operations.delete(id);
      }
    }

    if (operations.size <= maxSize) return;
    const terminal = [...operations.values()]
      .filter((operation) => operation.status !== "running")
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    for (const operation of terminal) {
      if (operations.size <= maxSize) break;
      operations.delete(operation.id);
    }
  }

  async function execute(operation: SetupOperation, steps: RunnableStep[]): Promise<void> {
    try {
      for (const runnable of steps) {
        const step = operation.steps.find((candidate) => candidate.id === runnable.id);
        if (!step) throw new Error(`Step ${runnable.id} is missing from ${operation.id}`);

        step.status = "running";
        step.error = undefined;
        step.action = undefined;

        try {
          await runnable.fn({
            setAction: (action) => {
              step.action = action;
            },
          });
          step.status = "succeeded";
          step.action = undefined;
        } catch (error) {
          const failure = toStepError(error);
          step.status = "failed";
          step.action = undefined;
          step.error = {
            code: failure.code,
            message: failure.message,
            ...(failure.detail ? { detail: failure.detail } : {}),
          };
          operation.status = "failed";
          operation.finishedAt = new Date(now()).toISOString();
          prune();
          return;
        }
      }

      operation.status = "succeeded";
      operation.finishedAt = new Date(now()).toISOString();
      prune();
    } catch (error) {
      operation.status = "failed";
      operation.finishedAt = new Date(now()).toISOString();
      options.onUnexpectedError?.(operation.id, error);
      prune();
    }
  }

  return {
    start(steps) {
      prune(Math.max(0, maxOperations - 1));
      const requestedIds = new Set(steps.map((step) => step.id));
      const conflict = [...operations.values()].find(
        (operation) =>
          operation.status === "running" &&
          operation.steps.some((step) => requestedIds.has(step.id)),
      );
      if (conflict) throw new ConcurrentOperationError(conflict.id);

      const startedAt = new Date(now()).toISOString();
      const operation: SetupOperation = {
        id: `op-${idGenerator()}`,
        status: "running",
        steps: steps.map(({ id, title }) => ({ id, title, status: "pending" })),
        startedAt,
      };
      operations.set(operation.id, operation);
      void execute(operation, steps);
      return copyOperation(operation);
    },

    get(id) {
      prune();
      const operation = operations.get(id);
      return operation ? copyOperation(operation) : null;
    },
  };
}
