import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "../utils/test-helpers.js";
import { GitHubEventPoller } from "./github-event-poller.js";
import { saveAutomations } from "../state/automations.js";
import type { Automation } from "../types.js";
import type { AutomationScheduler } from "./automation-scheduler.js";

// ── Mock gh CLI and state persistence ────────────────────────────────

vi.mock("../utils/github.js", () => ({
  gh: vi.fn(async () => ({ stdout: "[]", stderr: "" })),
  parseGitHubRepo: vi.fn((url: string) => {
    if (url.includes("github.com")) return { owner: "test-owner", repo: "test-repo" };
    return null;
  }),
  isGhInstalled: vi.fn(async () => true),
}));

vi.mock("../state/state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../state/state.js")>();
  return {
    ...actual,
    loadProject: vi.fn(async () => ({
      id: "proj-1",
      name: "Test Project",
      url: "https://github.com/test-owner/test-repo",
      createdAt: "2026-01-01T00:00:00Z",
      workspaces: [],
    })),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDir: string;
let dataDir: string;

function makeSchedulerStub(): AutomationScheduler {
  return {
    isRunning: vi.fn(() => false),
    executeEventRun: vi.fn(async () => ({})),
  } as unknown as AutomationScheduler;
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: "auto-1",
    name: "PR Review",
    enabled: true,
    projectId: "proj-1",
    trigger: {
      type: "github_event",
      events: ["pull_request.opened"],
    },
    action: { type: "agent", modelId: "claude:opus-4-6", userPromptInline: "Review this PR" },
    notification: { onComplete: true, onFailure: true },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await createTempDir();
  dataDir = join(tmpDir, "data");
  vi.clearAllMocks();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// ── Tests ────────────────────────────────────────────────────────────

describe("GitHubEventPoller", () => {
  describe("constructor", () => {
    it("creates instance without error", () => {
      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);
      expect(poller).toBeDefined();
    });
  });

  describe("start/stop", () => {
    it("starts and stops without error", async () => {
      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);

      // Start with a large interval so it doesn't fire during the test
      await poller.start(600_000);
      poller.stop();
    });

    it("stop is safe to call multiple times", () => {
      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);

      poller.stop();
      poller.stop();
    });

    it("stop is safe to call without start", () => {
      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);
      poller.stop();
    });
  });

  describe("poll with no github_event automations", () => {
    it("returns early without making gh calls when no automations exist", async () => {
      const { gh } = await import("../utils/github.js");
      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);

      await poller.poll();

      // gh should not be called for PR/issue listing (only isGhInstalled is called)
      expect(gh).not.toHaveBeenCalled();
    });

    it("returns early when only cron automations exist", async () => {
      const { gh } = await import("../utils/github.js");
      const cronAuto = makeAutomation({
        trigger: { type: "cron", expression: "0 * * * *" },
      });
      await saveAutomations([cronAuto], dataDir);

      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);

      await poller.poll();

      expect(gh).not.toHaveBeenCalled();
    });

    it("returns early when gh is not installed", async () => {
      const { isGhInstalled } = await import("../utils/github.js");
      vi.mocked(isGhInstalled).mockResolvedValueOnce(false);

      const auto = makeAutomation();
      await saveAutomations([auto], dataDir);

      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);

      await poller.poll();

      // Should exit before loading automations
      expect(scheduler.isRunning).not.toHaveBeenCalled();
    });
  });

  describe("poll reentrancy guard", () => {
    it("skips concurrent polls", async () => {
      const { isGhInstalled } = await import("../utils/github.js");
      let callCount = 0;
      vi.mocked(isGhInstalled).mockImplementation(async () => {
        callCount++;
        // Simulate slow check
        await new Promise((r) => setTimeout(r, 50));
        return true;
      });

      const scheduler = makeSchedulerStub();
      const poller = new GitHubEventPoller(dataDir, scheduler);

      // Fire two polls concurrently
      const p1 = poller.poll();
      const p2 = poller.poll();
      await Promise.all([p1, p2]);

      // Second poll should have returned early due to reentrancy guard
      expect(callCount).toBe(1);
    });
  });
});
