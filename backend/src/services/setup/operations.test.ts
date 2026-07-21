import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createOperation,
  getOperation,
  listOperations,
  appendLog,
  updateStep,
  runOperation,
  reapStaleOperations,
  findRunningOperation,
  ConcurrentOperationError,
  StepError,
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

async function readLog(opId: string): Promise<Array<{ seq: number; line: string }>> {
  const raw = await readFile(join(dataDir, "setup", opId, "log.jsonl"), "utf-8");
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { seq: number; line: string });
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
    expect(result.steps[1].status).toBe("succeeded");
  });

  it("rejects a second op touching the same step", async () => {
    const first = await createOperation("guided-setup", steps("a"), dataDir);
    // Leave `first` in running state without finishing.
    await runOperationLeaveRunning(first.id, dataDir);

    const second = await createOperation("guided-setup", steps("a"), dataDir);
    await expect(runOperation(second.id, [okStep("a")], dataDir)).rejects.toBeInstanceOf(
      ConcurrentOperationError,
    );
  });

  it("allows concurrent ops on disjoint steps", async () => {
    const first = await createOperation("guided-setup", steps("a"), dataDir);
    await runOperationLeaveRunning(first.id, dataDir);

    const second = await createOperation("guided-setup", steps("b"), dataDir);
    const result = await runOperation(second.id, [okStep("b")], dataDir);
    expect(result.status).toBe("succeeded");
  });
});

describe("runOperation concurrency & failure persistence", () => {
  it("serializes appendLog so seq stays unique and contiguous under concurrency", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        appendLog(op.id, { stepId: "a", line: `line-${i}` }, dataDir),
      ),
    );
    const all = await readLog(op.id);
    const seqs = all.map((l) => l.seq);
    expect(seqs.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(new Set(seqs).size).toBe(20);
  });

  it("lets only one of two overlapping runs execute the step (run-start TOCTOU)", async () => {
    let ran = 0;
    const slow: RunnableStep = {
      id: "a",
      title: "a",
      fn: async () => {
        ran += 1;
        await new Promise((r) => setTimeout(r, 40));
      },
    };
    const first = await createOperation("guided-setup", steps("a"), dataDir);
    const second = await createOperation("guided-setup", steps("a"), dataDir);

    const results = await Promise.allSettled([
      runOperation(first.id, [slow], dataDir),
      runOperation(second.id, [slow], dataDir),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConcurrentOperationError,
    );
    expect(ran).toBe(1);
  });

  it("clears a stale interactive action when a step is retried", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    const setActionThenFail: RunnableStep = {
      id: "a",
      title: "a",
      fn: async (_emit, ctx) => {
        await ctx.setAction({ kind: "open_url_with_code", url: "https://x", code: "OLD-CODE" });
        throw new StepError("DEVICE_CODE_EXPIRED", "expired");
      },
    };
    await runOperation(op.id, [setActionThenFail], dataDir);
    let loaded = await getOperation(op.id, dataDir);
    expect(loaded?.steps[0].action).toBeDefined();

    // Retry: the stale action must be gone before/while the retry runs.
    await runOperation(op.id, [okStep("a")], dataDir);
    loaded = await getOperation(op.id, dataDir);
    expect(loaded?.steps[0].status).toBe("succeeded");
    expect(loaded?.steps[0].action).toBeUndefined();
  });

  it("persists a terminal failed state on an unexpected (non-step) error, never leaving it pending", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    // A runnable step whose id is not part of the operation forces updateStep to
    // throw at step-start (outside the per-step try) — an unexpected error.
    await expect(
      runOperation(op.id, [okStep("not-a-real-step")], dataDir),
    ).rejects.toBeTruthy();
    const after = await getOperation(op.id, dataDir);
    expect(after?.status).toBe("failed");
  });
});

/** Helper: mark an op running without a runner finishing it. */
async function runOperationLeaveRunning(id: string, dir: string): Promise<void> {
  const op = await getOperation(id, dir);
  if (!op) throw new Error("missing");
  op.status = "running";
  const { writeJsonAtomic } = await import("../../state/state.js");
  await writeJsonAtomic(join(dir, "setup", id, "state.json"), op, join(dir, "setup", id));
}

describe("logs", () => {
  it("appendLog assigns monotonic seq", async () => {
    const op = await createOperation("guided-setup", steps("a"), dataDir);
    await appendLog(op.id, { stepId: "a", line: "one" }, dataDir);
    await appendLog(op.id, { stepId: "a", line: "two" }, dataDir);
    await appendLog(op.id, { stepId: "a", line: "three" }, dataDir);

    const all = await readLog(op.id);
    expect(all.map((l) => l.seq)).toEqual([0, 1, 2]);
    expect(all.map((l) => l.line)).toEqual(["one", "two", "three"]);
  });

  it("run emits step log lines with a monotonic seq", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    await runOperation(op.id, [okStep("a", "hi-a"), okStep("b", "hi-b")], dataDir);
    const lines = await readLog(op.id);
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
  it("marks any running op failed with INTERRUPTED on its running step", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    await updateStep(op.id, "a", { status: "running" }, dataDir);
    const { writeJsonAtomic } = await import("../../state/state.js");
    const current = (await getOperation(op.id, dataDir))!;
    current.status = "running";
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

  it("after reaping, the op can be resumed and succeed", async () => {
    const op = await createOperation("guided-setup", steps("a", "b"), dataDir);
    // a already succeeded, b was running when interrupted.
    await updateStep(op.id, "a", { status: "succeeded" }, dataDir);
    await updateStep(op.id, "b", { status: "running" }, dataDir);
    const { writeJsonAtomic } = await import("../../state/state.js");
    const current = (await getOperation(op.id, dataDir))!;
    current.status = "running";
    await writeJsonAtomic(
      join(dataDir, "setup", op.id, "state.json"),
      current,
      join(dataDir, "setup", op.id),
    );

    await reapStaleOperations(dataDir);
    expect(await findRunningOperation("guided-setup", ["a", "b"], dataDir)).toBeNull();

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
