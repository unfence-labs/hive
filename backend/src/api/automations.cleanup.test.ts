import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { createTempDir } from "../utils/test-helpers.js";
import { saveAutomations } from "../state/automations.js";
import type { Automation } from "../types.js";

const mocks = vi.hoisted(() => ({
  git: vi.fn(async () => ({ stdout: "", stderr: "" })),
  bareRepoPath: vi.fn(() => "/tmp/bare-repo"),
}));

vi.mock("../utils/git.js", () => ({
  git: mocks.git,
}));

vi.mock("../utils/paths.js", () => ({
  bareRepoPath: mocks.bareRepoPath,
}));

import { automationRoutes } from "./automations.js";

let tmpDir: string;
let dataDir: string;
let app: FastifyInstance;

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "Test Auto",
    enabled: true,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Do something" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  app = Fastify();
  await app.register((instance) => automationRoutes(instance, { dataDir }));
  await app.ready();
});

afterEach(async () => {
  await app.close();
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("DELETE /api/automations/:id - git worktree cleanup", () => {
  it("removes project-linked automation worktree before deleting automation dir", async () => {
    await saveAutomations([makeAutomation({ projectId: "proj-1" })], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/automations/auto-1" });
    expect(res.statusCode).toBe(204);

    const wsPath = join(dataDir, "automations", "auto-1", "workspace");
    expect(mocks.bareRepoPath).toHaveBeenCalledWith(dataDir, "proj-1");
    expect(mocks.git).toHaveBeenCalledWith(
      ["worktree", "remove", "--force", wsPath],
      "/tmp/bare-repo",
    );
  });

  it("prunes stale worktree refs when worktree removal fails", async () => {
    mocks.git
      .mockRejectedValueOnce(new Error("worktree already missing"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });
    await saveAutomations([makeAutomation({ projectId: "proj-1" })], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/automations/auto-1" });
    expect(res.statusCode).toBe(204);

    const wsPath = join(dataDir, "automations", "auto-1", "workspace");
    expect(mocks.git).toHaveBeenNthCalledWith(
      1,
      ["worktree", "remove", "--force", wsPath],
      "/tmp/bare-repo",
    );
    expect(mocks.git).toHaveBeenNthCalledWith(
      2,
      ["worktree", "prune"],
      "/tmp/bare-repo",
    );
  });

  it("skips git cleanup for non project-linked automations", async () => {
    await saveAutomations([makeAutomation({ projectId: undefined })], dataDir);

    const res = await app.inject({ method: "DELETE", url: "/api/automations/auto-1" });
    expect(res.statusCode).toBe(204);
    expect(mocks.git).not.toHaveBeenCalled();
    expect(mocks.bareRepoPath).not.toHaveBeenCalled();
  });
});
