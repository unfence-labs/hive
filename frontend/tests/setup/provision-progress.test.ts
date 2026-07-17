import { describe, expect, it } from "vitest";
import { applyProvisionEvent, initialProgress } from "@/pages/setup/provision-progress";
import type { ProvisionEvent } from "@/lib/provision-client";

function fold(events: ProvisionEvent[]) {
  return events.reduce(applyProvisionEvent, initialProgress());
}

describe("provision progress reducer", () => {
  it("seeds planned steps as pending on run_start", () => {
    const state = fold([
      { kind: "run_start", seq: 0, runId: "r", scriptVersion: "1", resume: false, stepsPlanned: ["a", "b"] },
    ]);
    expect(state.steps.map((s) => s.id)).toEqual(["a", "b"]);
    expect(state.steps.every((s) => s.status === "pending")).toBe(true);
    expect(state.status).toBe("running");
  });

  it("marks a step running then succeeded", () => {
    const state = fold([
      { kind: "run_start", seq: 0, runId: "r", scriptVersion: "1", resume: false, stepsPlanned: ["a"] },
      { kind: "step_start", seq: 1, step: "a", title: "Step A" },
      { kind: "step_log", seq: 2, step: "a", line: "working" },
      { kind: "step_ok", seq: 3, step: "a" },
      { kind: "run_end", seq: 4, status: "ok" },
    ]);
    expect(state.steps[0]).toMatchObject({ id: "a", title: "Step A", status: "succeeded", lastLine: "working" });
    expect(state.status).toBe("succeeded");
  });

  it("captures errors with error code and step", () => {
    const state = fold([
      { kind: "run_start", seq: 0, runId: "r", scriptVersion: "1", resume: false, stepsPlanned: ["a", "b"] },
      { kind: "step_start", seq: 1, step: "a", title: "A" },
      { kind: "step_ok", seq: 2, step: "a" },
      { kind: "step_start", seq: 3, step: "b", title: "B" },
      { kind: "step_error", seq: 4, step: "b", errorCode: "TS_AUTHKEY_INVALID", detail: "bad key" },
      { kind: "run_end", seq: 5, status: "error" },
    ]);
    expect(state.status).toBe("failed");
    expect(state.error).toEqual({ code: "TS_AUTHKEY_INVALID", step: "b", detail: "bad key" });
    expect(state.steps.find((s) => s.id === "b")?.status).toBe("failed");
  });

  it("handles skipped steps on resume", () => {
    const state = fold([
      { kind: "run_start", seq: 0, runId: "r", scriptVersion: "1", resume: true, stepsPlanned: ["a", "b"] },
      { kind: "step_skip", seq: 1, step: "a", reason: "already-satisfied" },
      { kind: "step_start", seq: 2, step: "b", title: "B" },
      { kind: "step_ok", seq: 3, step: "b" },
      { kind: "run_end", seq: 4, status: "ok" },
    ]);
    expect(state.steps.find((s) => s.id === "a")?.status).toBe("skipped");
    expect(state.status).toBe("succeeded");
  });
});
