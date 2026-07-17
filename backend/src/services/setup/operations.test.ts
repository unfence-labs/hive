import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createOperation,
  getOperation,
  listOperations,
  appendLog,
  readLogSince,
  updateStep,
  runOperation,
  reapStaleOperations,
  findRunningOperation,
  ConcurrentOperationError,
  StepError,
  STALE_HEARTBEAT_MS,
  type RunnableStep,
} from "./operations.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-setup-ops-test-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function steps(...ids: string[]): Array<{ id: string; title: string }> {
  return ids.map((id) => ({ id, title: id }));
}

function okStep(id: string, line = `${id} ran`): RunnableStep {
  return {
    id,
    title: id,
    fn: async (emit) => {
      await emit({ stream: "stdout", line });
    },
  };
}

describe("createOperation / getOperation", () => {
  it("creates a pending operation with pending steps", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    expect(op.id).toMatch(/^op-/);
    expect(op.status).toBe("pending");
    expect(op.steps.map((s) => s.status)).toEqual(["pending", "pending"]);

    const loaded = await getOperation(op.id, dataDir);
    expect(loaded).toEqual(op);
  });

  it("returns null for a missing operation", async () => {
    expect(await getOperation("op-nope", dataDir)).toBeNull();
  });
});

describe("runOperation", () => {
  it("runs all steps and marks the op succeeded", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    const result = await runOperation(op.id, [okStep("a"), okStep("b")], dataDir);

    expect(result.status).toBe("succeeded");
    expect(result.steps.map((s) => s.status)).toEqual(["succeeded", "succeeded"]);
    expect(result.finishedAt).toBeDefined();
    for (const s of result.steps) {
      expect(s.attempts).toBe(1);
      expect(s.logRange).toBeDefined();
    }
  });

  it("captures structured step data returned by the step fn", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    const step: RunnableStep = {
      id: "a",
      title: "a",
      fn: async () => ({ nodeVersion: "22.17.0" }),
    };
    const result = await runOperation(op.id, [step], dataDir);
    expect(result.steps[0].data).toEqual({ nodeVersion: "22.17.0" });
  });

  it("marks the op failed on the first failing step and leaves later steps pending", async () => {
    const op = await createOperation("guided-setup", steps("a", "b", "c"), dataDir);
    const failing: RunnableStep = {
      id: "b",
      title: "b",
      fn: async () => {
        throw new StepError("APT_FAILURE", "boom", { hint: "retry" });
      },
    };
    const result = await runOperation(op.id, [okStep("a"), failing, okStep("c")], dataDir);

    expect(result.status).toBe("failed");
    expect(result.steps.map((s) => s.status)).toEqual(["succeeded", "failed", "pending"]);
    expect(result.steps[1].error).toEqual({ code: "APT_FAILURE", message: "boom", hint: "retry" });
  });

  it("maps a plain thrown error to UNKNOWN", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    const failing: RunnableStep = {
      id: "a",
      title: "a",
      fn: async () => {
        throw new Error("kaboom");
      },
    };
    const result = await runOperation(op.id, [failing], dataDir);
    expect(result.steps[0].error?.code).toBe("UNKNOWN");
    expect(result.steps[0].error?.message).toBe("kaboom");
  });

  it("resumes: already-succeeded steps are skipped on re-run", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);

    // First run: a succeeds, b fails (simulated interruption after a).
    const failB: RunnableStep = {
      id: "b",
      title: "b",
      fn: async () => {
        throw new StepError("INTERRUPTED", "interrupted");
      },
    };
    await runOperation(op.id, [okStep("a"), failB], dataDir);

    // Re-run with an "a" that would throw if executed — it must be skipped.
    const aMustNotRun: RunnableStep = {
      id: "a",
      title: "a",
      fn: async () => {
        throw new Error("step a should have been skipped");
      },
    };
    const result = await runOperation(op.id, [aMustNotRun, okStep("b")], dataDir);

    expect(result.status).toBe("succeeded");
    expect(result.steps[0].status).toBe("succeeded");
    expect(result.steps[0].attempts).toBe(1); // not re-attempted
    expect(result.steps[1].status).toBe("succeeded");
    expect(result.steps[1].attempts).toBe(2); // retried
  });

  it("enforces one running op per kind", async () => {
    const first = await createOperation("guided-setup", steps("a"), dataDir);
    // Leave `first` in running state without finishing.
    await runOperationLeaveRunning(first.id, dataDir);

    const second = await createOperation("guided-setup", steps("a"), dataDir);
    await expect(runOperation(second.id, [okStep("a")], dataDir)).rejects.toBeInstanceOf(
      ConcurrentOperationError,
    );
  });
});

/** Helper: mark an op running without a runner finishing it (fresh heartbeat). */
async function runOperationLeaveRunning(id: string, dir: string): Promise<void> {
  const op = await getOperation(id, dir);
  if (!op) throw new Error("missing");
  op.status = "running";
  op.heartbeatAt = new Date().toISOString();
  const { writeJsonAtomic } = await import("../../state/state.js");
  await writeJsonAtomic(join(dir, "setup", id, "state.json"), op, join(dir, "setup", id));
}

describe("logs", () => {
  it("appendLog assigns monotonic seq and readLogSince filters", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    await appendLog(op.id, { stepId: "a", line: "one" }, dataDir);
    await appendLog(op.id, { stepId: "a", line: "two" }, dataDir);
    await appendLog(op.id, { stepId: "a", line: "three" }, dataDir);

    const all = await readLogSince(op.id, -1, dataDir);
    expect(all.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(all.map((l) => l.line)).toEqual(["one", "two", "three"]);

    const since0 = await readLogSince(op.id, 0, dataDir);
    expect(since0.map((l) => l.seq)).toEqual([1, 2]);

    const since2 = await readLogSince(op.id, 2, dataDir);
    expect(since2).toEqual([]);
  });

  it("run emits step log lines with a monotonic seq", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    await runOperation(op.id, [okStep("a", "hi-a"), okStep("b", "hi-b")], dataDir);
    const lines = await readLogSince(op.id, -1, dataDir);
    const seqs = lines.map((l) => l.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(lines.some((l) => l.line === "hi-a")).toBe(true);
    expect(lines.some((l) => l.line === "hi-b")).toBe(true);
  });
});

describe("updateStep", () => {
  it("merges a patch into a single step", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    await updateStep(op.id, "b", { status: "skipped" }, dataDir);
    const loaded = await getOperation(op.id, dataDir);
    expect(loaded?.steps[1].status).toBe("skipped");
    expect(loaded?.steps[0].status).toBe("pending");
  });
});

describe("reapStaleOperations", () => {
  it("marks a stale running op failed with INTERRUPTED on its running step", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    // Simulate a crash mid-run: op running, step a running, stale heartbeat.
    const staleTs = new Date(Date.now() - STALE_HEARTBEAT_MS - 5_000).toISOString();
    await updateStep(op.id, "a", { status: "running" }, dataDir);
    const { writeJsonAtomic } = await import("../../state/state.js");
    const current = (await getOperation(op.id, dataDir))!;
    current.status = "running";
    current.heartbeatAt = staleTs;
    await writeJsonAtomic(
      join(dataDir, "setup", op.id, "state.json"),
      current,
      join(dataDir, "setup", op.id),
    );

    const reaped = await reapStaleOperations(dataDir);
    expect(reaped).toEqual([op.id]);

    const after = await getOperation(op.id, dataDir);
    expect(after?.status).toBe("failed");
    expect(after?.steps[0].status).toBe("failed");
    expect(after?.steps[0].error?.code).toBe("INTERRUPTED");
    // Non-running step untouched.
    expect(after?.steps[1].status).toBe("pending");
  });

  it("leaves a fresh running op alone", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    await runOperationLeaveRunning(op.id, dataDir);
    const reaped = await reapStaleOperations(dataDir);
    expect(reaped).toEqual([]);
    expect((await getOperation(op.id, dataDir))?.status).toBe("running");
  });

  it("after reaping, the op can be resumed and succeed", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    // a already succeeded, b was running when interrupted.
    await updateStep(op.id, "a", { status: "succeeded" }, dataDir);
    await updateStep(op.id, "b", { status: "running" }, dataDir);
    const { writeJsonAtomic } = await import("../../state/state.js");
    const current = (await getOperation(op.id, dataDir))!;
    current.status = "running";
    current.heartbeatAt = new Date(Date.now() - STALE_HEARTBEAT_MS - 1000).toISOString();
    await writeJsonAtomic(
      join(dataDir, "setup", op.id, "state.json"),
      current,
      join(dataDir, "setup", op.id),
    );

    await reapStaleOperations(dataDir);
    expect(await findRunningOperation("guided-setup", dataDir)).toBeNull();

    const result = await runOperation(op.id, [okStep("a"), okStep("b")], dataDir);
    expect(result.status).toBe("succeeded");
    expect(result.steps.map((s) => s.status)).toEqual(["succeeded", "succeeded"]);
  });
});

describe("listOperations", () => {
  it("lists newest first", async () => {
    const a = await createOperation("guided-setup", steps("x"), dataDir);
    await new Promise((r) => setTimeout(r, 5));
    const b = await createOperation("guided-setup", steps("y"), dataDir);
    const list = await listOperations(dataDir);
    expect(list.map((o) => o.id)).toEqual([b.id, a.id]);
  });

  it("returns [] when no setup dir exists", async () => {
    const empty = await mkdtemp(join(tmpdir(), "hive-empty-"));
    expect(await listOperations(empty)).toEqual([]);
    await rm(empty, { recursive: true, force: true });
  });
});

describe("persistence", () => {
  it("state.json is valid JSON on disk", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    const raw = await readFile(join(dataDir, "setup", op.id, "state.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
