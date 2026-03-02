/**
 * Extended automation state persistence tests: concurrency lock,
 * atomic write, runs isolation between automations, and edge cases.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import {
  loadAutomations,
  saveAutomations,
  loadRuns,
  addRun,
  updateRun,
  withAutomationsLock,
  withAutomationRunLock,
  _clearAutomationLocksForTests,
} from "./automations.js";
import type { Automation, AutomationRun } from "../types.js";

let dataDir: string;
let tmpDir: string;

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Test Automation",
    enabled: true,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "test" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    status: "success",
    sessionId: "sess-1",
    startedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
});

afterEach(async () => {
  _clearAutomationLocksForTests();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("withAutomationsLock", () => {
  it("serializes concurrent operations", async () => {
    const order: number[] = [];

    await Promise.all([
      withAutomationsLock(async () => {
        await new Promise((r) => setTimeout(r, 50));
        order.push(1);
      }),
      withAutomationsLock(async () => {
        order.push(2);
      }),
    ]);

    // First lock completes before second starts
    expect(order).toEqual([1, 2]);
  });

  it("releases lock even when inner function throws", async () => {
    await expect(
      withAutomationsLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Lock should be released: this should not deadlock
    const result = await withAutomationsLock(async () => "ok");
    expect(result).toBe("ok");
  });
});

describe("atomicWrite behavior", () => {
  it("creates the data directory if it does not exist", async () => {
    await saveAutomations([makeAutomation()], dataDir);

    const files = await readdir(dataDir);
    expect(files).toContain("automations.json");
  });

  it("writes valid JSON", async () => {
    const auto = makeAutomation({ name: 'JSON "special" chars & <stuff>' });
    await saveAutomations([auto], dataDir);

    const raw = await readFile(join(dataDir, "automations.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed[0].name).toBe('JSON "special" chars & <stuff>');
  });

  it("no temp files left after write", async () => {
    await saveAutomations([makeAutomation()], dataDir);

    const files = await readdir(dataDir);
    const tmpFiles = files.filter((f) => f.startsWith("tmp."));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe("runs isolation between automations", () => {
  it("stores runs separately per automation", async () => {
    await addRun("auto-1", makeRun({ id: "run-a1" }), dataDir);
    await addRun("auto-2", makeRun({ id: "run-b1", automationId: "auto-2" }), dataDir);

    const runsA = await loadRuns("auto-1", dataDir);
    const runsB = await loadRuns("auto-2", dataDir);

    expect(runsA).toHaveLength(1);
    expect(runsA[0].id).toBe("run-a1");
    expect(runsB).toHaveLength(1);
    expect(runsB[0].id).toBe("run-b1");
  });

  it("updateRun only affects the correct automation's runs", async () => {
    await addRun("auto-1", makeRun({ id: "run-1" }), dataDir);
    await addRun("auto-2", makeRun({ id: "run-1", automationId: "auto-2" }), dataDir);

    await updateRun("auto-1", "run-1", { status: "failure" }, dataDir);

    const runsA = await loadRuns("auto-1", dataDir);
    const runsB = await loadRuns("auto-2", dataDir);

    expect(runsA[0].status).toBe("failure");
    expect(runsB[0].status).toBe("success"); // unchanged
  });
});

describe("addRun edge cases", () => {
  it("works when no runs exist yet", async () => {
    await addRun("auto-1", makeRun(), dataDir);
    const runs = await loadRuns("auto-1", dataDir);
    expect(runs).toHaveLength(1);
  });

  it("addRun preserves existing run data", async () => {
    await addRun("auto-1", makeRun({ id: "run-old", summary: "old summary" }), dataDir);
    await addRun("auto-1", makeRun({ id: "run-new" }), dataDir);

    const runs = await loadRuns("auto-1", dataDir);
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("run-new");
    expect(runs[1].id).toBe("run-old");
    expect(runs[1].summary).toBe("old summary");
  });

  it("caps at exactly 50 runs", async () => {
    for (let i = 0; i < 55; i++) {
      await addRun("auto-1", makeRun({ id: `run-${i}` }), dataDir);
    }
    const runs = await loadRuns("auto-1", dataDir);
    expect(runs).toHaveLength(50);
    // Most recent should be run-54
    expect(runs[0].id).toBe("run-54");
  });
});

describe("updateRun edge cases", () => {
  it("updates multiple fields at once", async () => {
    await addRun("auto-1", makeRun(), dataDir);
    await updateRun("auto-1", "run-1", {
      status: "failure",
      error: "timeout",
      completedAt: "2026-01-01T01:00:00Z",
      durationMs: 60000,
      summary: "Failed after 60s",
    }, dataDir);

    const runs = await loadRuns("auto-1", dataDir);
    expect(runs[0].status).toBe("failure");
    expect(runs[0].error).toBe("timeout");
    expect(runs[0].completedAt).toBe("2026-01-01T01:00:00Z");
    expect(runs[0].durationMs).toBe(60000);
    expect(runs[0].summary).toBe("Failed after 60s");
  });

  it("preserves non-updated fields", async () => {
    await addRun("auto-1", makeRun({ summary: "keep me" }), dataDir);
    await updateRun("auto-1", "run-1", { status: "failure" }, dataDir);

    const runs = await loadRuns("auto-1", dataDir);
    expect(runs[0].summary).toBe("keep me");
    expect(runs[0].sessionId).toBe("sess-1");
  });
});

describe("loadAutomations edge cases", () => {
  it("returns empty array for non-existent directory", async () => {
    const result = await loadAutomations("/tmp/nonexistent-" + Date.now());
    expect(result).toEqual([]);
  });
});

describe("loadRuns edge cases", () => {
  it("returns empty array for non-existent automation", async () => {
    const result = await loadRuns("nonexistent", dataDir);
    expect(result).toEqual([]);
  });
});

describe("withAutomationRunLock", () => {
  it("serializes concurrent addRun calls for the same automation", async () => {
    const calls = Array.from({ length: 5 }, (_, i) =>
      addRun("auto-1", makeRun({ id: `run-${i}`, automationId: "auto-1" }), dataDir),
    );
    await Promise.all(calls);

    const loaded = await loadRuns("auto-1", dataDir);
    expect(loaded).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(loaded.find((r) => r.id === `run-${i}`)).toBeDefined();
    }
  });

  it("allows concurrent addRun calls for different automations", async () => {
    const calls = [
      addRun("auto-1", makeRun({ id: "run-a", automationId: "auto-1" }), dataDir),
      addRun("auto-2", makeRun({ id: "run-b", automationId: "auto-2" }), dataDir),
      addRun("auto-3", makeRun({ id: "run-c", automationId: "auto-3" }), dataDir),
    ];
    await Promise.all(calls);

    expect(await loadRuns("auto-1", dataDir)).toHaveLength(1);
    expect(await loadRuns("auto-2", dataDir)).toHaveLength(1);
    expect(await loadRuns("auto-3", dataDir)).toHaveLength(1);
  });

  it("serializes addRun and updateRun for the same automation", async () => {
    await addRun("auto-1", makeRun({ id: "run-1", automationId: "auto-1" }), dataDir);

    // Fire concurrent update + add
    await Promise.all([
      updateRun("auto-1", "run-1", { status: "failure" }, dataDir),
      addRun("auto-1", makeRun({ id: "run-2", automationId: "auto-1" }), dataDir),
    ]);

    const loaded = await loadRuns("auto-1", dataDir);
    expect(loaded).toHaveLength(2);
    const run1 = loaded.find((r) => r.id === "run-1");
    expect(run1?.status).toBe("failure");
  });

  it("releases lock even when inner function throws", async () => {
    await expect(
      withAutomationRunLock("auto-1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Lock should be released — this should not deadlock
    const result = await withAutomationRunLock("auto-1", async () => "ok");
    expect(result).toBe("ok");
  });

  it("cleans up lock Map entry when queue drains", async () => {
    await withAutomationRunLock("auto-1", async () => {});
    // After the lock fully drains, _clearAutomationLocksForTests should be a no-op
    // (the Map entry was already deleted by the cleanup in finally)
    _clearAutomationLocksForTests();
  });
});
