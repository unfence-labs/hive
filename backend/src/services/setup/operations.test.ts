import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolOperation } from "@hive/shared/setup-types";
import {
  createToolOperationStore,
  ToolOperationError,
  type ToolOperationStore,
} from "./operations.js";

let dataDir: string;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function readState(): Promise<ToolOperation[]> {
  return JSON.parse(
    await readFile(join(dataDir, "setup-operations.json"), "utf-8"),
  ) as ToolOperation[];
}

/** Look an operation up the way a client does: on the listing, by id. */
function find(store: ToolOperationStore, id: string): ToolOperation | undefined {
  return store.list().find((operation) => operation.id === id);
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "hive-setup-ops-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("tool operation store", () => {
  it("runs an operation to a terminal success state", async () => {
    const store = await createToolOperationStore({ dataDir });
    const phases: string[] = [];

    const { operation, joined } = await store.start("claude", "install", async ({ setPhase }) => {
      setPhase("running");
      phases.push("ran");
    });

    expect(joined).toBe(false);
    expect(operation.status).toBe("running");
    expect(operation.id).toMatch(/^op-[A-Za-z0-9_-]{10}$/);

    await store.whenIdle();
    const finished = find(store, operation.id);
    expect(finished?.status).toBe("succeeded");
    expect(finished?.phase).toBe("done");
    expect(finished?.finishedAt).toBeTruthy();
    expect(phases).toEqual(["ran"]);
  });

  it("joins an operation already running for the same tool instead of duplicating it", async () => {
    const store = await createToolOperationStore({ dataDir });
    const gate = deferred();
    let runs = 0;

    const first = await store.start("claude", "install", async () => {
      runs += 1;
      await gate.promise;
    });
    const second = await store.start("claude", "install", async () => {
      runs += 1;
    });

    expect(second.joined).toBe(true);
    expect(second.operation.id).toBe(first.operation.id);
    expect(runs).toBe(1);

    gate.resolve();
    await store.whenIdle();
    expect(runs).toBe(1);
  });

  it("joins across kinds: an update request attaches to a running install", async () => {
    const store = await createToolOperationStore({ dataDir });
    const gate = deferred();
    let runs = 0;

    const install = await store.start("codex", "install", async () => {
      runs += 1;
      await gate.promise;
    });
    const update = await store.start("codex", "update", async () => {
      runs += 1;
    });

    expect(update.joined).toBe(true);
    expect(update.operation.id).toBe(install.operation.id);
    expect(update.operation.kind).toBe("install");
    expect(runs).toBe(1);

    gate.resolve();
    await store.whenIdle();
  });

  it("lets a different tool run concurrently", async () => {
    const store = await createToolOperationStore({ dataDir });
    const gate = deferred();

    const claude = await store.start("claude", "install", async () => {
      await gate.promise;
    });
    const codex = await store.start("codex", "install", async () => {
      await gate.promise;
    });

    expect(codex.joined).toBe(false);
    expect(codex.operation.id).not.toBe(claude.operation.id);
    expect(store.list()).toHaveLength(2);

    gate.resolve();
    await store.whenIdle();
  });

  it("starts a fresh operation once the previous one for the tool has finished", async () => {
    const store = await createToolOperationStore({ dataDir });
    const first = await store.start("claude", "install", async () => {});
    await store.whenIdle();

    const second = await store.start("claude", "update", async () => {});
    expect(second.joined).toBe(false);
    expect(second.operation.id).not.toBe(first.operation.id);
    await store.whenIdle();
  });
});

describe("failure reporting", () => {
  it("carries the typed reason and the bounded excerpt from a ToolOperationError", async () => {
    const store = await createToolOperationStore({ dataDir });
    const { operation } = await store.start("claude", "install", async () => {
      throw new ToolOperationError("network", "registry unreachable", {
        outputExcerpt: "npm error code ENOTFOUND",
      });
    });
    await store.whenIdle();

    const failed = find(store, operation.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.failure).toEqual({
      reason: "network",
      message: "registry unreachable",
      outputExcerpt: "npm error code ENOTFOUND",
    });
  });

  it("truncates an oversized excerpt rather than persisting it whole", async () => {
    const store = await createToolOperationStore({ dataDir });
    const { operation } = await store.start("codex", "install", async () => {
      throw new ToolOperationError("command_failed", "boom", {
        outputExcerpt: "x".repeat(10_000),
      });
    });
    await store.whenIdle();

    expect(find(store, operation.id)?.failure?.outputExcerpt).toHaveLength(2_000);
  });

  it("reports an unexpected throw as a command failure and surfaces it to the logger", async () => {
    const onUnexpectedError = vi.fn();
    const store = await createToolOperationStore({ dataDir, onUnexpectedError });

    const { operation } = await store.start("claude", "install", async () => {
      throw new Error("something nobody typed");
    });
    await store.whenIdle();

    expect(find(store, operation.id)?.failure).toEqual({
      reason: "command_failed",
      message: "something nobody typed",
    });
    expect(onUnexpectedError).toHaveBeenCalledWith(operation.id, expect.any(Error));
  });
});

describe("durability across a restart", () => {
  it("persists a running operation before returning, so a crash leaves a record", async () => {
    const store = await createToolOperationStore({ dataDir });
    const gate = deferred();
    const { operation } = await store.start("claude", "install", async () => {
      await gate.promise;
    });

    const persisted = await readState();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ id: operation.id, status: "running" });

    gate.resolve();
    await store.whenIdle();
  });

  it("reaps an operation left running by the previous process instead of wedging it", async () => {
    const first = await createToolOperationStore({ dataDir });
    const gate = deferred();
    const { operation } = await first.start("claude", "install", async () => {
      await gate.promise;
    });

    // A new process over the same data directory: the old run has no process
    // behind it and nothing else would ever move it off "running".
    const rebooted = await createToolOperationStore({ dataDir });
    const recovered = find(rebooted, operation.id);
    expect(recovered?.status).toBe("failed");
    expect(recovered?.failure?.reason).toBe("interrupted");
    expect(recovered?.finishedAt).toBeTruthy();

    // And the reaping is itself durable — a third boot must not re-reap or
    // resurrect it.
    const again = await createToolOperationStore({ dataDir });
    expect(find(again, operation.id)?.failure?.reason).toBe("interrupted");

    gate.resolve();
    await first.whenIdle();
  });

  it("keeps a finished operation readable after a restart", async () => {
    const first = await createToolOperationStore({ dataDir });
    const { operation } = await first.start("codex", "install", async () => {});
    await first.whenIdle();

    const rebooted = await createToolOperationStore({ dataDir });
    expect(find(rebooted, operation.id)?.status).toBe("succeeded");
  });

  it("reports a failed state write instead of taking the process down with it", async () => {
    const onUnexpectedError = vi.fn();
    // A path that cannot hold a directory: every write attempt fails.
    const unwritable = join(dataDir, "blocker", "nested");
    await writeFile(join(dataDir, "blocker"), "not a directory", "utf-8");

    const store = await createToolOperationStore({ dataDir: unwritable, onUnexpectedError });
    const { operation } = await store.start("claude", "install", async () => {});
    await store.whenIdle();

    // The operation still ran to a terminal state; only durability was lost.
    expect(find(store, operation.id)?.status).toBe("succeeded");
    expect(onUnexpectedError).toHaveBeenCalledWith("persist", expect.anything());
  });

  it("starts clean when the state file is unreadable rather than refusing to boot", async () => {
    await writeFile(join(dataDir, "setup-operations.json"), "{not json", "utf-8");
    const store = await createToolOperationStore({ dataDir });
    expect(store.list()).toEqual([]);
  });

  it("ignores entries that do not match the operation shape", async () => {
    await writeFile(
      join(dataDir, "setup-operations.json"),
      JSON.stringify([{ id: "op-x", tool: "not-a-tool", status: "running" }, null]),
      "utf-8",
    );
    const store = await createToolOperationStore({ dataDir });
    expect(store.list()).toEqual([]);
  });
});

describe("retention", () => {
  it("forgets a finished operation once it is older than the retention window", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const store = await createToolOperationStore({
      dataDir,
      now: () => clock,
      retentionMs: 60_000,
    });

    const { operation } = await store.start("claude", "install", async () => {});
    await store.whenIdle();
    expect(find(store, operation.id)?.status).toBe("succeeded");

    clock += 61_000;
    expect(find(store, operation.id)).toBeUndefined();
    expect(store.list()).toEqual([]);
  });

  it("never prunes an operation that is still running", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const store: ToolOperationStore = await createToolOperationStore({
      dataDir,
      now: () => clock,
      retentionMs: 1,
    });
    const gate = deferred();
    const { operation } = await store.start("claude", "install", async () => {
      await gate.promise;
    });

    clock += 3_600_000;
    expect(find(store, operation.id)?.status).toBe("running");

    gate.resolve();
    await store.whenIdle();
  });
});
