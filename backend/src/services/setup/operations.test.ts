import { describe, expect, it } from "vitest";
import {
  ConcurrentOperationError,
  createSetupOperationRunner,
  StepError,
  type RunnableStep,
} from "./operations.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForTerminal(
  runner: ReturnType<typeof createSetupOperationRunner>,
  id: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (runner.get(id)?.status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Operation ${id} did not finish`);
}

function step(id: string, fn: RunnableStep["fn"] = async () => {}): RunnableStep {
  return { id, title: `Step ${id}`, fn };
}

describe("createSetupOperationRunner", () => {
  it("creates an exact public id and runs steps in order", async () => {
    const calls: string[] = [];
    const runner = createSetupOperationRunner({ idGenerator: () => "Abc_12-x" });
    const operation = runner.start([
      step("a", async () => { calls.push("a"); }),
      step("b", async () => { calls.push("b"); }),
    ]);

    expect(operation.id).toBe("op-Abc_12-x");
    expect(operation.status).toBe("running");
    await waitForTerminal(runner, operation.id);
    expect(calls).toEqual(["a", "b"]);
    expect(runner.get(operation.id)).toMatchObject({
      status: "succeeded",
      steps: [{ status: "succeeded" }, { status: "succeeded" }],
      finishedAt: expect.any(String),
    });
  });

  it("captures a typed failure detail and leaves later steps pending", async () => {
    const runner = createSetupOperationRunner();
    const operation = runner.start([
      step("fail", async () => {
        throw new StepError("NETWORK", "Install failed", { detail: "DNS lookup failed" });
      }),
      step("later"),
    ]);

    await waitForTerminal(runner, operation.id);
    expect(runner.get(operation.id)).toMatchObject({
      status: "failed",
      steps: [
        {
          status: "failed",
          error: { code: "NETWORK", message: "Install failed", detail: "DNS lookup failed" },
        },
        { status: "pending" },
      ],
    });
  });

  it("maps untyped failures to UNKNOWN", async () => {
    const runner = createSetupOperationRunner();
    const operation = runner.start([step("fail", async () => { throw new Error("boom"); })]);
    await waitForTerminal(runner, operation.id);
    expect(runner.get(operation.id)?.steps[0].error).toEqual({
      code: "UNKNOWN",
      message: "boom",
    });
  });

  it("publishes an interactive action while a step is running", async () => {
    const gate = deferred();
    const runner = createSetupOperationRunner();
    const operation = runner.start([
      step("auth", async (ctx) => {
        await ctx.setAction({
          kind: "open_url_with_code",
          url: "https://example.test/device",
          code: "ABCD-1234",
        });
        await gate.promise;
      }),
    ]);

    await Promise.resolve();
    expect(runner.get(operation.id)?.steps[0].action).toEqual({
      kind: "open_url_with_code",
      url: "https://example.test/device",
      code: "ABCD-1234",
    });
    gate.resolve();
    await waitForTerminal(runner, operation.id);
    expect(runner.get(operation.id)?.steps[0].action).toBeUndefined();
  });

  it("admits only one overlapping operation and reports its id", async () => {
    const gate = deferred();
    const runner = createSetupOperationRunner();
    const first = runner.start([step("same", async () => gate.promise)]);

    expect(() => runner.start([step("same")])).toThrowError(
      expect.objectContaining<Partial<ConcurrentOperationError>>({
        existingOperationId: first.id,
      }),
    );
    gate.resolve();
    await waitForTerminal(runner, first.id);
  });

  it("allows disjoint operations to run concurrently", async () => {
    const gate = deferred();
    const runner = createSetupOperationRunner();
    const first = runner.start([step("a", async () => gate.promise)]);
    const second = runner.start([step("b")]);

    await waitForTerminal(runner, second.id);
    expect(runner.get(second.id)?.status).toBe("succeeded");
    gate.resolve();
    await waitForTerminal(runner, first.id);
  });

  it("expires terminal operations after fifteen minutes", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const runner = createSetupOperationRunner({ now: () => clock });
    const operation = runner.start([step("a")]);
    await waitForTerminal(runner, operation.id);

    clock += 15 * 60 * 1_000 + 1;
    expect(runner.get(operation.id)).toBeNull();
  });

  it("keeps at most the configured number of recent operations", async () => {
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    let sequence = 0;
    const runner = createSetupOperationRunner({
      now: () => clock,
      maxOperations: 2,
      idGenerator: () => String(++sequence).padStart(8, "0"),
    });
    const ids: string[] = [];
    for (const id of ["a", "b", "c"]) {
      const operation = runner.start([step(id)]);
      ids.push(operation.id);
      await waitForTerminal(runner, operation.id);
      clock += 1_000;
    }

    expect(runner.get(ids[0])).toBeNull();
    expect(runner.get(ids[1])).not.toBeNull();
    expect(runner.get(ids[2])).not.toBeNull();
  });

  it("returns snapshots that callers cannot mutate", async () => {
    const runner = createSetupOperationRunner();
    const operation = runner.start([step("a")]);
    operation.steps[0].status = "failed";
    await waitForTerminal(runner, operation.id);
    expect(runner.get(operation.id)?.steps[0].status).toBe("succeeded");
  });
});
