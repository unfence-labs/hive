import { describe, expect, it, vi } from "vitest";
import { pollOperation, SetupApiError, type SetupApi } from "@/hooks/useSetupApi";
import type { SetupOperation } from "@hive/shared/setup-types";

function op(status: SetupOperation["status"]): SetupOperation {
  return { id: "op-1", status, steps: [] } as unknown as SetupOperation;
}

function apiReturning(results: Array<SetupOperation | Error>): SetupApi {
  let call = 0;
  return {
    getStatus: vi.fn(),
    run: vi.fn(),
    submitClaudeToken: vi.fn(),
    getOperation: vi.fn(async () => {
      const result = results[Math.min(call++, results.length - 1)];
      if (result instanceof Error) throw result;
      return result;
    }),
  } as unknown as SetupApi;
}

describe("pollOperation", () => {
  it("polls until the operation reaches a terminal status", async () => {
    const api = apiReturning([op("running"), op("running"), op("succeeded")]);
    const updates: string[] = [];

    const result = await pollOperation("op-1", (o) => updates.push(o.status), {
      intervalMs: 1,
      api,
    });

    expect(result.status).toBe("succeeded");
    expect(updates).toEqual(["running", "running", "succeeded"]);
  });

  it("maps a 404 to a typed INTERRUPTED error", async () => {
    const api = apiReturning([new SetupApiError("404 gone", undefined, 404)]);

    await expect(pollOperation("op-1", () => {}, { intervalMs: 1, api })).rejects.toMatchObject({
      code: "INTERRUPTED",
      status: 404,
    });
  });

  it("rethrows non-404 failures untouched", async () => {
    const api = apiReturning([new SetupApiError("409 busy", "CONCURRENT_RUN", 409)]);

    await expect(pollOperation("op-1", () => {}, { intervalMs: 1, api })).rejects.toMatchObject({
      code: "CONCURRENT_RUN",
      status: 409,
    });
  });

  it("stops polling when the signal aborts", async () => {
    const controller = new AbortController();
    const api = apiReturning([op("running")]);
    const updates: string[] = [];

    const poll = pollOperation("op-1", (o) => updates.push(o.status), {
      intervalMs: 5,
      api,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(updates.length).toBeGreaterThan(0));
    controller.abort();

    await expect(poll).rejects.toMatchObject({ name: "AbortError" });
  });
});
