import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import {
  loadAutomations,
  saveAutomations,
  loadRuns,
  saveRuns,
  addRun,
  updateRun,
} from "./automations.js";
import type { Automation, AutomationRun } from "../types.js";

let dataDir: string;

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-test1",
    name: "Test Automation",
    enabled: true,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "claude:opus-4-6" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-test1",
    automationId: "auto-test1",
    status: "success",
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  const tmp = await createTempDir();
  dataDir = join(tmp, "data");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

describe("automations persistence", () => {
  it("returns empty array when no file exists", async () => {
    const result = await loadAutomations(dataDir);
    expect(result).toEqual([]);
  });

  it("saves and loads automations", async () => {
    const autos = [makeAutomation(), makeAutomation({ id: "auto-test2", name: "Second" })];
    await saveAutomations(autos, dataDir);
    const loaded = await loadAutomations(dataDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].id).toBe("auto-test1");
    expect(loaded[1].name).toBe("Second");
  });

  it("overwrites on save", async () => {
    await saveAutomations([makeAutomation()], dataDir);
    await saveAutomations([makeAutomation({ name: "Updated" })], dataDir);
    const loaded = await loadAutomations(dataDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Updated");
  });
});

describe("runs persistence", () => {
  it("returns empty array when no file exists", async () => {
    const result = await loadRuns("auto-test1", dataDir);
    expect(result).toEqual([]);
  });

  it("saves and loads runs", async () => {
    const runs = [makeRun(), makeRun({ id: "run-test2" })];
    await saveRuns("auto-test1", runs, dataDir);
    const loaded = await loadRuns("auto-test1", dataDir);
    expect(loaded).toHaveLength(2);
  });

  it("addRun prepends and caps at 50", async () => {
    // Fill with 50 runs
    const existing: AutomationRun[] = [];
    for (let i = 0; i < 50; i++) {
      existing.push(makeRun({ id: `run-old-${i}` }));
    }
    await saveRuns("auto-test1", existing, dataDir);

    // Add one more
    await addRun("auto-test1", makeRun({ id: "run-new" }), dataDir);

    const loaded = await loadRuns("auto-test1", dataDir);
    expect(loaded).toHaveLength(50);
    expect(loaded[0].id).toBe("run-new");
    // Oldest should be dropped
    expect(loaded.find((r) => r.id === "run-old-49")).toBeUndefined();
  });

  it("updateRun modifies an existing run", async () => {
    await saveRuns("auto-test1", [makeRun()], dataDir);
    await updateRun("auto-test1", "run-test1", { status: "failure", error: "boom" }, dataDir);

    const loaded = await loadRuns("auto-test1", dataDir);
    expect(loaded[0].status).toBe("failure");
    expect(loaded[0].error).toBe("boom");
  });

  it("updateRun no-ops for unknown runId", async () => {
    await saveRuns("auto-test1", [makeRun()], dataDir);
    await updateRun("auto-test1", "nonexistent", { status: "failure" }, dataDir);

    const loaded = await loadRuns("auto-test1", dataDir);
    expect(loaded[0].status).toBe("success");
  });
});
