import { join } from "node:path";
import { readdir, readFile, appendFile, mkdir } from "node:fs/promises";
import { nanoid } from "nanoid";
import type {
  SetupOperation,
  SetupOperationKind,
  SetupStep,
  SetupLogLine,
} from "@hive/shared/setup-types";
import type { SetupErrorCode } from "@hive/shared/setup-errors";
import { getDataDir, writeJsonAtomic } from "../../state/state.js";

/**
 * Durable multi-step setup operation engine (§6.1). Each operation lives under
 * DATA_DIR/setup/<opId>/ as `state.json` (atomic) + `log.jsonl` (append-only,
 * monotonic seq). The in-process runner executes ordered async step functions,
 * heartbeats while running, and is resumable (already-succeeded steps skip).
 */

const HEARTBEAT_INTERVAL_MS = 5_000;
/** A running op whose heartbeat is older than this is considered dead (§6.1). */
export const STALE_HEARTBEAT_MS = 30_000;

/** Thrown/returned when a second op of the same kind is requested (409, §6.1). */
export class ConcurrentOperationError extends Error {
  readonly kind: SetupOperationKind;
  readonly existingOperationId: string;
  constructor(kind: SetupOperationKind, existingOperationId: string) {
    super(`An operation of kind '${kind}' is already running`);
    this.name = "ConcurrentOperationError";
    this.kind = kind;
    this.existingOperationId = existingOperationId;
  }
}

/** Emit callback handed to each step function; writes one log line. */
export type EmitFn = (args: {
  stream?: SetupLogLine["stream"];
  line: string;
}) => Promise<void>;

/** A step function. Resolves on success; throws (optionally a StepError) to fail. */
export type StepFn = (emit: EmitFn) => Promise<void | Record<string, unknown>>;

/** A named step to run: metadata + its function. */
export interface RunnableStep {
  id: string;
  title: string;
  fn: StepFn;
}

/** A typed error a step can throw to control the reported error code. */
export class StepError extends Error {
  readonly code: SetupErrorCode;
  readonly hint?: string;
  readonly exitCode?: number;
  constructor(code: SetupErrorCode, message: string, opts?: { hint?: string; exitCode?: number }) {
    super(message);
    this.name = "StepError";
    this.code = code;
    this.hint = opts?.hint;
    this.exitCode = opts?.exitCode;
  }
}

function setupRoot(dataDir: string): string {
  return join(dataDir, "setup");
}

function opDir(dataDir: string, opId: string): string {
  return join(setupRoot(dataDir), opId);
}

function statePath(dataDir: string, opId: string): string {
  return join(opDir(dataDir, opId), "state.json");
}

function logPath(dataDir: string, opId: string): string {
  return join(opDir(dataDir, opId), "log.jsonl");
}

function nowIso(): string {
  return new Date().toISOString();
}

async function writeState(dataDir: string, op: SetupOperation): Promise<void> {
  const dir = opDir(dataDir, op.id);
  await writeJsonAtomic(statePath(dataDir, op.id), op, dir);
}

/** Create a new operation with steps in `pending` state and persist it. */
export async function createOperation(
  kind: SetupOperationKind,
  steps: Array<{ id: string; title: string }>,
  dataDir: string = getDataDir(),
): Promise<SetupOperation> {
  const now = nowIso();
  const op: SetupOperation = {
    id: `op-${nanoid(8)}`,
    kind,
    status: "pending",
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title,
      status: "pending",
      attempts: 0,
    })),
    startedAt: now,
    heartbeatAt: now,
  };
  await mkdir(opDir(dataDir, op.id), { recursive: true });
  await writeState(dataDir, op);
  return op;
}

/** Read one operation's state, or null if it does not exist. */
export async function getOperation(
  id: string,
  dataDir: string = getDataDir(),
): Promise<SetupOperation | null> {
  try {
    const raw = await readFile(statePath(dataDir, id), "utf-8");
    return JSON.parse(raw) as SetupOperation;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** List all operations, newest first (by startedAt). */
export async function listOperations(
  dataDir: string = getDataDir(),
): Promise<SetupOperation[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(setupRoot(dataDir), { withFileTypes: true });
  } catch {
    return [];
  }
  const ops: SetupOperation[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const op = await getOperation(entry.name, dataDir);
    if (op) ops.push(op);
  }
  ops.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return ops;
}

/**
 * Read the next monotonic seq for an operation's log. Reads the last line's seq
 * and adds 1. Kept internal — callers use `appendLog`.
 */
async function nextSeq(dataDir: string, opId: string): Promise<number> {
  const lines = await readAllLogLines(dataDir, opId);
  if (lines.length === 0) return 0;
  return lines[lines.length - 1].seq + 1;
}

async function readAllLogLines(dataDir: string, opId: string): Promise<SetupLogLine[]> {
  let raw: string;
  try {
    raw = await readFile(logPath(dataDir, opId), "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: SetupLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as SetupLogLine);
    } catch {
      // Skip a torn/partial line rather than failing the whole read.
    }
  }
  return out;
}

/**
 * Append one log line with the next monotonic seq. `seq`/`ts` are assigned here;
 * callers supply stepId/stream/line.
 */
export async function appendLog(
  id: string,
  line: { stepId: string; stream?: SetupLogLine["stream"]; line: string; ts?: string },
  dataDir: string = getDataDir(),
): Promise<SetupLogLine> {
  await mkdir(opDir(dataDir, id), { recursive: true });
  const seq = await nextSeq(dataDir, id);
  const entry: SetupLogLine = {
    seq,
    ts: line.ts ?? nowIso(),
    stepId: line.stepId,
    stream: line.stream ?? "system",
    line: line.line,
  };
  await appendFile(logPath(dataDir, id), JSON.stringify(entry) + "\n", "utf-8");
  return entry;
}

/** Read log lines with seq strictly greater than `since`. */
export async function readLogSince(
  id: string,
  since: number,
  dataDir: string = getDataDir(),
): Promise<SetupLogLine[]> {
  const lines = await readAllLogLines(dataDir, id);
  return lines.filter((l) => l.seq > since);
}

/** Patch a single step within an operation (merges fields) and persist. */
export async function updateStep(
  id: string,
  stepId: string,
  patch: Partial<SetupStep>,
  dataDir: string = getDataDir(),
): Promise<SetupOperation> {
  const op = await getOperation(id, dataDir);
  if (!op) throw new Error(`Operation ${id} not found`);
  const idx = op.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) throw new Error(`Step ${stepId} not found in operation ${id}`);
  op.steps[idx] = { ...op.steps[idx], ...patch };
  await writeState(dataDir, op);
  return op;
}

async function patchOperation(
  dataDir: string,
  id: string,
  patch: Partial<SetupOperation>,
): Promise<SetupOperation> {
  const op = await getOperation(id, dataDir);
  if (!op) throw new Error(`Operation ${id} not found`);
  const next = { ...op, ...patch };
  await writeState(dataDir, next);
  return next;
}

/** Return the id of a currently-running op of the given kind, if any. */
export async function findRunningOperation(
  kind: SetupOperationKind,
  dataDir: string = getDataDir(),
): Promise<string | null> {
  const ops = await listOperations(dataDir);
  const running = ops.find((o) => o.kind === kind && o.status === "running");
  return running?.id ?? null;
}

/**
 * Run (or resume) an operation's steps sequentially in-process. Steps already
 * `succeeded` are skipped. Heartbeats every ~5s while running. On the first
 * failing step, remaining steps stay pending and the op is marked `failed`.
 *
 * Enforces one running op per kind: throws {@link ConcurrentOperationError} if
 * another op of the same kind is already running.
 */
export async function runOperation(
  id: string,
  steps: RunnableStep[],
  dataDir: string = getDataDir(),
): Promise<SetupOperation> {
  const op = await getOperation(id, dataDir);
  if (!op) throw new Error(`Operation ${id} not found`);

  const otherRunning = await findRunningOperation(op.kind, dataDir);
  if (otherRunning && otherRunning !== id) {
    throw new ConcurrentOperationError(op.kind, otherRunning);
  }

  await patchOperation(dataDir, id, { status: "running", heartbeatAt: nowIso() });

  const heartbeat = setInterval(() => {
    void patchOperation(dataDir, id, { heartbeatAt: nowIso() }).catch(() => {
      /* best-effort heartbeat */
    });
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  try {
    for (const step of steps) {
      const current = await getOperation(id, dataDir);
      const stepState = current?.steps.find((s) => s.id === step.id);
      // Resume: skip already-succeeded steps.
      if (stepState?.status === "succeeded") continue;

      const startSeq = await nextSeq(dataDir, id);
      await updateStep(
        id,
        step.id,
        {
          status: "running",
          startedAt: nowIso(),
          attempts: (stepState?.attempts ?? 0) + 1,
          error: undefined,
          finishedAt: undefined,
        },
        dataDir,
      );

      const emit: EmitFn = async ({ stream, line }) => {
        await appendLog(id, { stepId: step.id, stream, line }, dataDir);
      };

      try {
        const data = await step.fn(emit);
        const lastSeq = Math.max(startSeq, (await nextSeq(dataDir, id)) - 1);
        await updateStep(
          id,
          step.id,
          {
            status: "succeeded",
            finishedAt: nowIso(),
            logRange: [startSeq, lastSeq],
            ...(data && typeof data === "object" ? { data } : {}),
          },
          dataDir,
        );
      } catch (err: unknown) {
        const stepError = toStepError(err);
        await appendLog(
          id,
          { stepId: step.id, stream: "stderr", line: stepError.message },
          dataDir,
        );
        const lastSeq = Math.max(startSeq, (await nextSeq(dataDir, id)) - 1);
        await updateStep(
          id,
          step.id,
          {
            status: "failed",
            finishedAt: nowIso(),
            exitCode: stepError.exitCode,
            logRange: [startSeq, lastSeq],
            error: {
              code: stepError.code,
              message: stepError.message,
              ...(stepError.hint ? { hint: stepError.hint } : {}),
            },
          },
          dataDir,
        );
        return await patchOperation(dataDir, id, {
          status: "failed",
          heartbeatAt: nowIso(),
          finishedAt: nowIso(),
        });
      }
    }

    return await patchOperation(dataDir, id, {
      status: "succeeded",
      heartbeatAt: nowIso(),
      finishedAt: nowIso(),
    });
  } finally {
    clearInterval(heartbeat);
  }
}

function toStepError(err: unknown): StepError {
  if (err instanceof StepError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new StepError("UNKNOWN", message);
}

/**
 * Boot reaper (§6.1): any op left `running` with a stale heartbeat is marked
 * `failed`, and its running step gets error code INTERRUPTED. Idempotent.
 * Returns the ids of operations that were reaped.
 */
export async function reapStaleOperations(
  dataDir: string = getDataDir(),
  now: number = Date.now(),
): Promise<string[]> {
  const ops = await listOperations(dataDir);
  const reaped: string[] = [];
  for (const op of ops) {
    if (op.status !== "running") continue;
    const heartbeatMs = Date.parse(op.heartbeatAt);
    const stale = Number.isNaN(heartbeatMs) || now - heartbeatMs > STALE_HEARTBEAT_MS;
    if (!stale) continue;

    for (const step of op.steps) {
      if (step.status === "running") {
        await updateStep(
          op.id,
          step.id,
          {
            status: "failed",
            finishedAt: nowIso(),
            error: {
              code: "INTERRUPTED",
              message: "The operation was interrupted and can be safely resumed.",
            },
          },
          dataDir,
        );
      }
    }
    await patchOperation(dataDir, op.id, { status: "failed", finishedAt: nowIso() });
    reaped.push(op.id);
  }
  return reaped;
}
