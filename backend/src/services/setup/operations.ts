import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import {
  isSetupToolId,
  TOOL_OUTPUT_EXCERPT_MAX,
  type SetupToolId,
  type StartToolOperationResponse,
  type ToolFailureReason,
  type ToolOperation,
  type ToolOperationKind,
  type ToolOperationPhase,
} from "@hive/shared/setup-types";
import { writeAtomic } from "../../utils/file-sync.js";

const STATE_FILE = "setup-operations.json";

/** How long a finished operation stays visible before it is forgotten. */
const DEFAULT_RETENTION_MS = 15 * 60 * 1_000;

export interface OperationContext {
  setPhase: (phase: ToolOperationPhase) => void;
}

export type OperationRunner = (ctx: OperationContext) => Promise<void>;

/** A failure carrying the reason a client should render, not just a string. */
export class ToolOperationError extends Error {
  readonly reason: ToolFailureReason;
  readonly outputExcerpt?: string;

  constructor(
    reason: ToolFailureReason,
    message: string,
    opts: { outputExcerpt?: string } = {},
  ) {
    super(message);
    this.name = "ToolOperationError";
    this.reason = reason;
    this.outputExcerpt = opts.outputExcerpt?.slice(0, TOOL_OUTPUT_EXCERPT_MAX);
  }
}

export interface ToolOperationStore {
  /** Most recent operation per tool, running or recently finished. */
  list: () => ToolOperation[];
  /**
   * Start work for a tool, or attach to the operation already running for it.
   * Serialisation is per tool rather than per tool-and-kind: install and
   * update resolve to the same package-manager invocation, so a second caller
   * asking for the other one wants the result of the one in flight, not a
   * competing process writing the same directory.
   */
  start: (
    tool: SetupToolId,
    kind: ToolOperationKind,
    run: OperationRunner,
  ) => Promise<StartToolOperationResponse>;
  /** Resolves once nothing is in flight. Test seam. */
  whenIdle: () => Promise<void>;
}

export interface ToolOperationStoreOptions {
  dataDir: string;
  now?: () => number;
  retentionMs?: number;
  onUnexpectedError?: (operationId: string, error: unknown) => void;
}

function isToolOperation(value: unknown): value is ToolOperation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ToolOperation>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.tool === "string" &&
    isSetupToolId(candidate.tool) &&
    (candidate.kind === "install" || candidate.kind === "update") &&
    (candidate.status === "running" ||
      candidate.status === "succeeded" ||
      candidate.status === "failed") &&
    typeof candidate.startedAt === "string"
  );
}

function toFailure(error: unknown): ToolOperation["failure"] {
  if (error instanceof ToolOperationError) {
    return {
      reason: error.reason,
      message: error.message,
      ...(error.outputExcerpt ? { outputExcerpt: error.outputExcerpt } : {}),
    };
  }
  return {
    reason: "command_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Creates the operation store and reaps anything the previous process left
 * behind.
 *
 * Operations are written to disk because the panel must survive a client
 * navigating away, and because a client that reconnects with no operation id
 * still has to find work in flight. That durability is what creates the
 * failure this reaper exists for: a process killed mid-install leaves a record
 * saying "running" with no process behind it, and nothing would ever move it.
 * On boot those records are terminal-ised as `interrupted`, which is both a
 * true statement and one the operator can act on.
 */
export async function createToolOperationStore(
  options: ToolOperationStoreOptions,
): Promise<ToolOperationStore> {
  const { dataDir } = options;
  const now = options.now ?? Date.now;
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const path = join(dataDir, STATE_FILE);

  /** At most one operation per tool: the newest supersedes the last. */
  const operations = new Map<SetupToolId, ToolOperation>();
  const inFlight = new Set<Promise<void>>();
  let writeChain: Promise<void> = Promise.resolve();

  /**
   * Serialised, atomic, and non-throwing. A state file that cannot be written
   * costs durability for one operation; letting that reject would surface as
   * an unhandled rejection from a background task and take the process with
   * it, which costs every session on the server.
   */
  function persist(): Promise<void> {
    const snapshot = [...operations.values()];
    writeChain = writeChain
      .then(() => writeAtomic(path, JSON.stringify(snapshot, null, 2)))
      .catch((error: unknown) => {
        options.onUnexpectedError?.("persist", error);
      });
    return writeChain;
  }

  function prune(): void {
    const cutoff = now() - retentionMs;
    for (const [tool, operation] of operations) {
      if (operation.status === "running") continue;
      if (operation.finishedAt && Date.parse(operation.finishedAt) <= cutoff) {
        operations.delete(tool);
      }
    }
  }

  // Load, then reap. A record still marked running belongs to a process that
  // no longer exists — this one just started.
  let reaped = false;
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as unknown;
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (!isToolOperation(entry)) continue;
      if (entry.status === "running") {
        reaped = true;
        entry.status = "failed";
        entry.phase = "done";
        entry.finishedAt = new Date(now()).toISOString();
        entry.failure = {
          reason: "interrupted",
          message: "Hive restarted while this operation was running.",
        };
      }
      operations.set(entry.tool, entry);
    }
  } catch {
    // No state file, or one this build cannot read: start clean rather than
    // refuse to boot over a cache.
  }
  prune();
  if (reaped) await persist();

  async function execute(operation: ToolOperation, run: OperationRunner): Promise<void> {
    try {
      await run({
        setPhase: (phase) => {
          operation.phase = phase;
        },
      });
      operation.status = "succeeded";
    } catch (error) {
      operation.status = "failed";
      operation.failure = toFailure(error);
      if (!(error instanceof ToolOperationError)) {
        options.onUnexpectedError?.(operation.id, error);
      }
    } finally {
      operation.phase = "done";
      operation.finishedAt = new Date(now()).toISOString();
      await persist();
    }
  }

  return {
    list() {
      prune();
      return structuredClone([...operations.values()]);
    },

    async start(tool, kind, run) {
      prune();
      const existing = operations.get(tool);
      if (existing?.status === "running") {
        return { operation: structuredClone(existing), joined: true };
      }

      const operation: ToolOperation = {
        id: `op-${nanoid(10)}`,
        tool,
        kind,
        status: "running",
        phase: "detecting",
        startedAt: new Date(now()).toISOString(),
      };
      operations.set(tool, operation);
      // Await the first write: a crash between here and the reply must leave a
      // record for the next boot to reap, otherwise the operation vanishes and
      // the panel shows nothing ever happened.
      await persist();

      const task = execute(operation, run).finally(() => inFlight.delete(task));
      inFlight.add(task);

      return { operation: structuredClone(operation), joined: false };
    },

    async whenIdle() {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
      await writeChain;
    },
  };
}
