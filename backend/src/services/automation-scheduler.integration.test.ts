import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTempDir, createFixtureRepo } from "../utils/test-helpers.js";
import { createProject } from "../projects/project-manager.js";
import { saveAutomations } from "../state/automations.js";
import { git } from "../utils/git.js";
import { AutomationScheduler } from "./automation-scheduler.js";
import type { Automation } from "../types.js";

vi.mock("../agents/conversation-session.js", async () => {
  const { EventEmitter } = await import("node:events");

  class MockSession extends EventEmitter {
    sendMessage() {
      process.nextTick(() => this.emit("message", { type: "done" }));
    }

    stop() {
      // No-op for tests.
    }

    async getMessages() {
      return [
        {
          id: "m1",
          sessionId: "sess-1",
          role: "assistant",
          content: "Work done.\n## Summary\nIntegration run ok.",
          timestamp: new Date().toISOString(),
        },
      ];
    }
  }

  return { ConversationSession: MockSession };
});

vi.mock("../agents/agent-manager.js", () => ({
  getNotifier: vi.fn(() => null),
}));

let tmpDir: string;
let dataDir: string;
let fixtureRepoUrl: string;

function makeAutomation(projectId: string): Automation {
  return {
    id: "auto-integration-1",
    name: "Integration Automation",
    enabled: true,
    projectId,
    trigger: { type: "cron", expression: "0 * * * *" },
    action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Run" },
    notification: { onComplete: false, onFailure: false },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir("hive-auto-integration-");
  dataDir = join(tmpDir, "data");
  const fixtureDir = join(tmpDir, "fixtures");
  await mkdir(fixtureDir, { recursive: true });
  fixtureRepoUrl = await createFixtureRepo(fixtureDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

describe("AutomationScheduler integration (real git worktree lifecycle)", () => {
  it("first run fetches latest remote commit before execution", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);

    const pushClone = join(tmpDir, "push-clone-latest");
    await git(["clone", fixtureRepoUrl, pushClone]);
    await git(["config", "user.email", "test@hive.dev"], pushClone);
    await git(["config", "user.name", "Test"], pushClone);
    await writeFile(join(pushClone, "latest-before-first-run.txt"), "latest\n", "utf-8");
    await git(["add", "."], pushClone);
    await git(["commit", "-m", "add latest file before first automation run"], pushClone);
    await git(["push", "origin", "main"], pushClone);
    const { stdout: expectedHead } = await git(["rev-parse", "HEAD"], pushClone);

    const auto = makeAutomation(project.id);
    await saveAutomations([auto], dataDir);

    const scheduler = new AutomationScheduler(dataDir);
    const run = await scheduler.triggerNow(auto.id);
    scheduler.stop();

    expect(run.status, run.error).toBe("success");

    const wsPath = join(dataDir, "automations", auto.id, "workspace");
    expect(existsSync(join(wsPath, "latest-before-first-run.txt"))).toBe(true);
    const latestFile = await readFile(join(wsPath, "latest-before-first-run.txt"), "utf-8");
    expect(latestFile).toBe("latest\n");

    const { stdout: workspaceHead } = await git(["rev-parse", "HEAD"], wsPath);
    expect(workspaceHead).toBe(expectedHead);
  });

  it("second run removes untracked and ignored files from automation workspace", async () => {
    const project = await createProject(fixtureRepoUrl, dataDir);

    const pushClone = join(tmpDir, "push-clone-ignore");
    await git(["clone", fixtureRepoUrl, pushClone]);
    await git(["config", "user.email", "test@hive.dev"], pushClone);
    await git(["config", "user.name", "Test"], pushClone);
    await writeFile(join(pushClone, ".gitignore"), "ignored.tmp\nignored-dir/\n", "utf-8");
    await git(["add", ".gitignore"], pushClone);
    await git(["commit", "-m", "add ignore rules"], pushClone);
    await git(["push", "origin", "main"], pushClone);

    const auto = makeAutomation(project.id);
    await saveAutomations([auto], dataDir);

    const scheduler = new AutomationScheduler(dataDir);
    const firstRun = await scheduler.triggerNow(auto.id);
    expect(firstRun.status, firstRun.error).toBe("success");

    const wsPath = join(dataDir, "automations", auto.id, "workspace");
    await writeFile(join(wsPath, "scratch-untracked.txt"), "temp\n", "utf-8");
    await writeFile(join(wsPath, "ignored.tmp"), "ignored\n", "utf-8");
    await mkdir(join(wsPath, "ignored-dir"), { recursive: true });
    await writeFile(join(wsPath, "ignored-dir", "artifact.txt"), "artifact\n", "utf-8");
    expect(existsSync(join(wsPath, "scratch-untracked.txt"))).toBe(true);
    expect(existsSync(join(wsPath, "ignored.tmp"))).toBe(true);
    expect(existsSync(join(wsPath, "ignored-dir", "artifact.txt"))).toBe(true);

    const secondRun = await scheduler.triggerNow(auto.id);
    scheduler.stop();
    expect(secondRun.status, secondRun.error).toBe("success");

    expect(existsSync(join(wsPath, "scratch-untracked.txt"))).toBe(false);
    expect(existsSync(join(wsPath, "ignored.tmp"))).toBe(false);
    expect(existsSync(join(wsPath, "ignored-dir"))).toBe(false);
  });
});
